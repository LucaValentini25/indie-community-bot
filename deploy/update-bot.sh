#!/usr/bin/env bash
#
# Pulls the newest image for one bot instance and restarts it — rolling the old
# one back if the new one does not come up healthy.
#
#   update-bot.sh prod     → /opt/bot-prod   (follows ghcr.io/<repo>:latest)
#   update-bot.sh dev      → /opt/bot-dev    (follows ghcr.io/<repo>:dev)
#
# Run from a systemd timer (see bot-update@.timer) so the server picks up a
# release on its own. Nothing needs to be reachable from the internet: this
# polls outward to GHCR rather than waiting to be pushed to.
#
# Exits 0 when there was nothing to do, which is the overwhelmingly common case.

set -euo pipefail

INSTANCE="${1:?usage: update-bot.sh <instance>   e.g. update-bot.sh prod}"
DIR="${BOT_ROOT:-/opt}/bot-${INSTANCE}"
COMPOSE_FILE="docker-compose.prod.yml"

# How long to give the container to report healthy before calling it a failure.
# The image's own HEALTHCHECK has a 40s start period, and connecting to the
# Discord gateway is the slow part, so do not cut this too fine.
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

log() { echo "[$(date -Is)] $*"; }

# Optional: a Discord webhook URL to shout into when a deploy fails or rolls
# back. The whole point of an unattended server is finding out without logging
# in, so this is worth setting. Put it in <dir>/deploy.env as DEPLOY_WEBHOOK=...
#
# Every message passed in is a literal written below, free of quotes and
# backslashes, so it needs no JSON escaping — which keeps this script from
# depending on jq or python being installed on the server.
notify() {
  [ -n "${DEPLOY_WEBHOOK:-}" ] || return 0
  curl -fsS -X POST "$DEPLOY_WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "{\"content\": \"$1\"}" \
    >/dev/null 2>&1 || log "warning: could not reach the notification webhook"
}

cd "$DIR"
[ -f "$COMPOSE_FILE" ] || { log "no $COMPOSE_FILE in $DIR"; exit 1; }

# Optional per-instance settings (DEPLOY_WEBHOOK, HEALTH_TIMEOUT). Absent is
# fine. systemd passes the same file in, so a manual run behaves identically.
# shellcheck source=/dev/null
[ -f deploy.env ] && . ./deploy.env

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

IMAGE="$(compose config --images | head -1)"
CONTAINER="$(compose ps -q bot)"

# The id `:latest` points at right now. Captured before the pull, because the
# pull is what moves the tag.
PREVIOUS="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"

log "checking $IMAGE"
compose pull --quiet bot

CURRENT="$(docker image inspect --format '{{.Id}}' "$IMAGE")"

if [ "$PREVIOUS" = "$CURRENT" ] && [ -n "$CONTAINER" ]; then
  log "already up to date"
  exit 0
fi

# Keep a handle on the outgoing image. Without this the old digest is
# unreferenced the moment the tag moves, and `docker image prune` can collect
# it — leaving nothing to roll back to.
if [ -n "$PREVIOUS" ]; then
  docker image tag "$PREVIOUS" "${IMAGE%:*}:rollback"
fi

log "starting ${CURRENT:0:19}"
compose up -d bot

# ── Health gate ──────────────────────────────────────────────────────────────
# Reads the container's own HEALTHCHECK, which requires /health to answer
# status:"ok" — i.e. the gateway is actually connected, not merely that the
# process is listening. A bad token fails here rather than sitting there
# looking fine.
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
container="$(compose ps -q bot)"
status=""

while [ "$(date +%s)" -lt "$deadline" ]; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo gone)"
  case "$status" in
    healthy) break ;;
    # An image with no HEALTHCHECK cannot be gated; take "running" as the best
    # available answer rather than rolling back every single deploy.
    none) docker inspect --format '{{.State.Running}}' "$container" | grep -q true && { status=healthy; break; } ;;
  esac
  sleep 5
done

if [ "$status" = "healthy" ]; then
  log "healthy — deploy complete"
  # Only prune once we are sure, and never the rollback image.
  docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
  exit 0
fi

# ── Rollback ─────────────────────────────────────────────────────────────────
log "NOT healthy after ${HEALTH_TIMEOUT}s (status: $status)"

if [ -z "$PREVIOUS" ]; then
  log "no previous image to roll back to — leaving the new one up"
  notify ":rotating_light: **${INSTANCE}**: the new build did not come up healthy, and there is no previous image to roll back to. The bot is down."
  exit 1
fi

log "rolling back to ${PREVIOUS:0:19}"
docker image tag "${IMAGE%:*}:rollback" "$IMAGE"
compose up -d bot

notify ":warning: **${INSTANCE}**: \`${CURRENT:7:12}\` failed its health check and was rolled back. The bot is running the previous build. Check \`journalctl -u bot-update@${INSTANCE}\`."
log "rolled back"
exit 1
