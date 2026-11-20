# Design

The booth should feel like a photo booth, not a website: you stand in front of a
mirror, press one button, watch a countdown, and a strip comes out of a slot.

## Principles

1. **The mirror is the screen.** The live camera takes all the room the screen
   allows. Nothing is drawn over faces. The viewfinder is exactly the shape of a
   hole in the frame, so what you see is what gets printed.
2. **One thing to press.** Each screen has a single gold action: the round shutter
   on the start screen, **Print** on the result. Everything else is quieter
   (outlined, then plain underlined text) so the order of importance is obvious.
3. **Progress is physical.** Four empty frames fill in as the photos are taken.
   Each photo flies from the mirror into its frame. There are no progress bars or dots.
4. **Readable from two metres.** The countdown digit is the biggest thing on the
   screen and sits beside the mirror. The instructions are a short heading and one
   sentence, in plain words and sentence case.
5. **The result is an object.** The finished strip slides out of a slot, casts a
   real shadow, and slides back in when it's sent to the printer.
6. **Motion copies machines.** Anything that moves does so like the mechanism it
   imitates: a soft flash, a dispense, a retract. It never moves just for show.
   With "reduce motion" on, it all happens at once.
7. **Calm, warm, dark.** The colours are the dark inside of a booth, photo-paper
   text, and one marigold accent for the button you press. There are no gradients,
   glows, glass, or emoji.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--booth` | `#181614` | Background (the inside of the booth) |
| `--paper` | `#f2ede4` | Main text |
| `--dim` | `#a59e94` | Secondary text |
| `--gold` | `#f2b53b` | The one action (`--gold-press` `#d99f2a`, text `--on-gold` `#1c1711`) |
| `--slot` | `#0a0908` | The print slot |
| `--line`, `--line-2` | paper at 16% / 36% | Outlines, frame edges |

**Type.** One family, Archivo (variable width), self-hosted in `fonts/`. The
headings and countdown use its condensed widths (62–85%). The text is 15–18 px and
the controls are 16–19 px, scaled with the screen height.

**Shapes.** Photos and frames have square corners. The shutter is round. Buttons
have a 2 px radius. Nothing a guest sees is pill-shaped.

## Screens

- **Start.** The mirror on one side. On the other side:
  - the wordmark;
  - the four frames;
  - "Four photos." and one sentence;
  - the shutter.

  On an upright screen everything stacks, with the shutter at the bottom within
  thumb reach.
- **Capture.** The shutter goes away while the photos are taken. In its place:
  - a large countdown;
  - "Photo 2 of 4";
  - a short cue such as "Look at the camera".

  The current frame has a gold outline. After the flash, the photo holds in the
  mirror, then flies into its frame.
- **Result.** The strip hangs from its slot.
  - **Panel:** "Your strip." and one sentence, then one quiet status line, then
    the buttons.
  - **Status line:** what Print gives you, or a short message such as "Saved to
    Downloads" or "Starting over in 8…".
  - **Buttons:** Print, then Retake a photo and Filters, then Save a copy and
    Start over.
  - **Retake mode:** everything except Cancel fades back while you choose the
    photo.
- **Messages.** A heading, one sentence, and a gold button. The start screen is
  never left blank.

## Sizes

The layout is built for a landscape Chromebook kiosk (1024×768 to 1920×1080).
It also works on tablets and phones, upright or sideways, down to 320×568:

- **Upright phones:** the mirror runs edge to edge.
- **Sideways phones:** the control panel uses the full height.
- **Notches and home bars:** safe-area insets are respected.

`node tests/run.js layout` checks that nothing overflows or overlaps at those
sizes.
