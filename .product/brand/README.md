# GBTI brand assets

The GBTI Network logo package: the monogram mark, the palette, the avatar set, and the favicon set, for manual
reuse (social profiles, decks, print, third-party tools). The live style guide is at https://gbti.network/brand/ and the same
mark art drives the site header, the favicons, and the browser-extension icons.

## Palette

| Name        | Hex       | Use                                             |
|-------------|-----------|-------------------------------------------------|
| Ink         | `#25232b` | primary dark, text, mark on light, icon tiles   |
| Brand green | `#1f9e5f` | accent, primary actions, mark on light          |
| Mint        | `#5fd49a` | green on dark, secondary accent                 |
| Paper       | `#faf9f8` | warm off-white page base                        |

Type: Baloo Da 2 (display and wordmark), Hanken Grotesk (body), JetBrains Mono (labels).

## Files

`logo/`: the monogram mark, white on transparent, recolored to each brand color. Square canvas, the glyph
trimmed and centered.

- `mark-ink.png`: ink mark, for light backgrounds.
- `mark-green.png`: brand-green mark, for light backgrounds.
- `mark-white.png`: white mark, for ink or green backgrounds.
- `mark-mint.png`: mint mark, for ink backgrounds.

`avatars/`: the mark centered on a brand ground at 1024 x 1024, for social profiles and app directories. The
mark sits at 50 percent of the canvas, which clears the 25 percent clear-space rule with room to spare and
survives every platform's circle crop. The square files are full bleed (for platforms that crop themselves);
the `-round` files are pre-cropped circles with transparent corners, for surfaces that do not crop. The same
files are served under https://gbti.network/brand/avatars/.

- `avatar-ink.png` / `avatar-ink-round.png`: white mark on ink. The primary avatar.
- `avatar-green.png` / `avatar-green-round.png`: white mark on brand green.
- `avatar-white.png` / `avatar-white-round.png`: ink mark on white, for dark surrounding UI.

`favicons/`: the mark on an ink rounded tile, at the standard sizes.

- `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`, `favicon-180x180.png`, `favicon-192x192.png`,
  `favicon-512x512.png`.
- `apple-touch-icon.png`: 180, for iOS home-screen.

## Lockup

The horizontal lockup is the mark plus the wordmark "GBTI" in Baloo Da 2, with the tagline "NETWORK" in mono
beneath. The mark sits at the wordmark's optical height, with a fixed gap. On light grounds use the ink mark and
ink wordmark; on ink or green grounds use the white mark and white wordmark.

## Usage rules

- Keep clear space of at least 25 percent of the mark on every side.
- Do not stretch the mark. Keep its aspect ratio.
- Do not place the mark on a low-contrast ground. Keep it legible.
- Do not recolor the mark outside this palette.

## Source

Built from the DesignSync "GBTI Logo Package" project. These PNGs are derived from the packaged monogram at the
project's export resolution. For a higher-resolution or vector master, export from the DesignSync project.
