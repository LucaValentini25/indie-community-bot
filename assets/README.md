# Assets

Drop-in customisation for the welcome card. Nothing here is required — the card
falls back to a generated gradient and a system font.

## `welcome/background.png`

Artwork behind the welcome card. **1000 × 350** is the exact card size; anything
wider works and is centre-cropped to fill.

The left ~60% is darkened so the avatar and text stay readable, so put the
interesting part of the image on the **right**. Key art, a screenshot, or a
tiled pattern all work. `background.jpg` is accepted too.

## `fonts/*.ttf` · `fonts/*.otf`

Any font file dropped here is registered as the family `Brand` and used for the
whole card. If the game has its own typeface, this is the only step.

Check the licence before shipping a font in a public repository — many free
fonts allow embedding but not redistribution.

## Preview your changes

```bash
npm run preview:card -- "#FF5C00" "Your Game"
```

Renders samples to `preview/` without touching Discord.
