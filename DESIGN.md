# Design

The booth should feel like a photo booth, not a website: you stand in front of a
mirror, press one big button, watch a countdown, and get a strip of four photos.

## Principles

1. **The mirror is the screen.** The live camera takes all the room the screen
   allows. Nothing is drawn over faces or around the picture. The viewfinder is
   exactly the shape of a hole in the frame, so what you see is what gets printed.
2. **One big button, always in the same place.** "Take photos" and "Print" are
   the same gold key, at the bottom of the panel.
3. **Three button weights, nothing else.**
   - **Gold key:** what to do next.
   - **Quiet grey keys:** the alternatives.
   - **Plain text:** the least important actions.

   Labels are centred. There are no outlined boxes that look like form fields
   and no underlined links. A button that isn't available yet is hollow.
4. **Say less, larger.** Each screen gets a heading and one line, with no full
   stops in headings and no paragraphs of fine print. A passing message such as
   "Saved to Downloads" replaces that line for a moment instead of adding another.
5. **Show progress only when there is progress.** The four frames appear when
   the photos start and fill in one by one. Before that they would just be
   empty boxes.
6. **The photos carry the colour.** The interface is the dark inside of a booth
   with photo-paper text. The only colour is the gold key; the strip's own
   artwork does the rest. There are no gradients, glows, glass, icons, emoji or
   decorative frames.
7. **Motion copies machines.** There's a soft flash, each photo drops into its
   frame, and the strip is fed down from the top of the screen and goes back up
   when it prints. Nothing moves for show. With "reduce motion" on, it all
   happens at once.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--booth` | `#181614` | Background (the inside of the booth) |
| `--paper` | `#f2ede4` | Main text, the selected filter |
| `--dim` | `#a59e94` | Secondary text, the wordmark |
| `--gold` | `#f2b53b` | The one key (`--gold-press` `#d99f2a`, text `--on-gold` `#1c1711`) |
| `--fill`, `--fill-2` | paper at 7% / 13% | Quiet keys (pressed) |
| `--line`, `--line-2` | paper at 16% / 36% | Empty frames, unavailable buttons |

**Type.** One family, Archivo (variable width), self-hosted in `fonts/`.
- **Headings and countdown:** its condensed widths (62–85%).
- **Text:** 15–18 px.
- **Controls:** 16–24 px.

All three scale with the screen height. The wordmark "STKEYCLUB" is small,
tracked capitals, like the name on the front of a camera.

**Shapes.** Photos and frames have square corners. Keys have a 2 px radius.
Nothing a guest sees is pill-shaped or round.

## Screens

- **Start:** the mirror on one side (on top on an upright screen).
  - The panel has the wordmark at the top, aligned with the top of the mirror.
  - At the bottom, aligned with the bottom of the mirror: "Four photos", "Look
    at the camera, not the screen.", then the Take photos key.
- **Capture:** the key goes away. In its place:
  - the four frames;
  - a large countdown;
  - "Photo 2 of 4" with a short cue.

  The current frame has a gold outline. After the flash, the photo holds in the
  mirror, then drops into its frame.
- **Result:** the strip beside a panel aligned with its bottom.
  - **Copy:** "Your strip" and "Prints two copies in about a minute."
  - **Print** (gold), then **Retake a photo** and **Filters** (quiet), then
    **Save a copy** and **Start over** (text).
  - **Retake mode:** everything except Cancel disappears while you tap the photo.
  - **Filters:** the names (None, B&W, Warm, Cool, Vintage) as keys. The strip
    itself is the preview.
- **Messages:** a heading, one sentence and a gold key. The start screen is
  never left blank.

## Sizes

The layout is built for a landscape Chromebook kiosk (1024×768 to 1920×1080).
It also works on tablets and phones, upright or sideways, down to 320×568:

- **Upright phones:** the mirror runs edge to edge with the key at the bottom.
- **Sideways phones:** the panel uses the full height.
- **Notches and home bars:** safe-area insets are respected.

`node tests/run.js layout` checks that nothing overflows or overlaps at those
sizes.
