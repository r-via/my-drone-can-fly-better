# Brand assets

Logo derived from the favicon (`src/app/icon.svg`): rounded `#0a0b12` tile,
22 % corner radius, two `#c6ff5e` slashes on a 100 grid. The wordmark is
Rajdhani 700, 0.14em tracking, converted to outlines - the SVGs need no font.

| File | Use |
| --- | --- |
| `mark.svg` | symbol in its tile, exact favicon replica. Works on any background. |
| `mark-bare.svg` | slashes only, `currentColor`. For inline JSX / one-colour print. |
| `logo-horizontal.svg` | main lockup, dark backgrounds (site, OG images). |
| `logo-horizontal-light.svg` | main lockup, light backgrounds. |
| `logo-stacked.svg` | square-ish lockup, dark backgrounds (avatars, social). |
| `logo-stacked-light.svg` | same, light backgrounds. |
| `logo-horizontal-mono.svg` | single-colour lockup via `currentColor`. |

PNGs are exports of the matching SVG - regenerate them rather than editing.

## Why two constructions

The accent `#c6ff5e` is far too light to sit on a white background (contrast
about 1.2:1). So the lockups are not simple recolours of one another:

- **dark backgrounds** use the free-standing `//`, matching the site header;
- **light backgrounds** keep the tile, which is what preserves the accent.

Never put bare lime slashes on a light surface, and never recolour the
wordmark to the accent.

## Clear space and minimum size

Keep a margin equal to the slash width (10 % of the symbol height) on all
sides. Minimum legible width: 180 px for the horizontal lockup, 96 px for the
stacked one, 16 px for the mark.
