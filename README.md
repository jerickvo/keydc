# STKEYCLUB Photo Booth

A full-screen photo booth for Chrome on a Chromebook. It takes 4 photos with a
DJI Osmo Pocket 3 (USB webcam mode), puts them into `frame.png`, and prints a
4×6 sheet with two strips on a Canon SELPHY CP1500.

- Plain HTML, CSS and JavaScript. No build step, no backend, no accounts, no analytics.
- Works offline after the first visit (service worker).
- Photos never leave the device. A Content-Security-Policy blocks every request
  to other sites.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css` | The page and its look (see `DESIGN.md`) |
| `fonts/` | Archivo, self-hosted so the booth looks the same offline (SIL Open Font License) |
| `config.js` | Defaults, plus the fallback hole positions for the frame |
| `frame.png` | The strip frame (600×1800 RGBA, transparent holes) |
| `js/` | App code: camera, frame and hole detection, composing, printing, operator menu, filters |
| `sw.js` | Offline cache. **Bump `VERSION` on every deploy** |
| `manifest.webmanifest`, `icons/` | Lets Chrome install it as a full-screen app |
| `vercel.json` | Keeps `sw.js` from being cached by the CDN |
| `tests/run.js` | Automated checks (Playwright + Chromium) |

## Run it locally

Camera access needs HTTPS, but `localhost` also counts as secure.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome and allow the camera.

## Deploy to Vercel

1. Change `VERSION` at the top of `sw.js` (for example `2026-11-20.1`). Do this on
   every deploy, or Chromebooks that already have the booth keep the old copy.
2. Push to GitHub.
3. On vercel.com: **Add New → Project → Import** this repository. Use framework preset
   **Other**, leave the build command empty, and leave the output directory at the default
   (the repository root). Click **Deploy**.
   - Vercel builds the repository's default branch for production. Right now that's
     `claude/practical-faraday-11rbkk`, the only branch. To use another branch, change it
     under **Settings → Git → Production Branch**.
   - Use the **production** URL (`https://<project>.vercel.app`) on the Chromebook.
     Preview URLs can ask for a Vercel login.

   Or from a terminal in this folder: `npx vercel` once to link the project, then `npx vercel --prod`.

## Replacing the frame

Drop the new file in as `frame.png`, bump `VERSION` in `sw.js`, and deploy. The
holes are found automatically from the transparent areas, at any resolution.
To check, open the operator menu: the info line at the bottom should say
`holes detected`. If it says `holes from config.js`, the new frame does not
have exactly 4 transparent holes, and the measured boxes in `config.js` are
being used instead.

> The `frame.png` in this repo was converted from the image uploaded in chat,
> which arrived as a compressed WebP. For the sharpest prints, replace it with
> your original PNG file.

## Operator menu

To open it, hold the **top-left corner for 2 seconds**, or press **o**. Close it with
**Done** or **Esc**. It has:

- **Camera:** the camera picker (remembered), and mirror toggles for the preview and the saved photo.
- **Capture:** countdown, pause between shots, sound, flash, and filters on/off.
- **Print:** page size (4×6 in or 100×148 mm), safety
  margin, print lock seconds, the sheets-sent counter (−1 / Reset), and **Test print**.
- **Saved sheets:** the last 20 printed sheets. Tap a sheet twice to reprint it.
  **Clear all** also needs two taps.
- **Booth:** idle reset seconds, Full screen, Reload, frame and offline status, and a log.

## Event-day hardware checklist

### The night before (with internet)

- [ ] Open the production URL in Chrome on the Chromebook and allow the camera. If Chrome
      offers "Allow this time" or "Allow while visiting", choose **Allow while visiting the site**.
- [ ] Open the operator menu. The bottom line should say **offline ready (v…)**.
- [ ] Optional: install it (Chrome menu → **Cast, save and share → Install page as app**,
      or the install icon in the address bar). It then opens in its own window. Use
      **Full screen** in the operator menu, or the ChromeOS full-screen key.
- [ ] Tap **Save a copy** once on a review screen. If Chrome asks to download multiple files, choose **Allow**.
- [ ] If the Chromebook is school-managed, its policies can block USB cameras, adding
      printers or installing apps. Check all of that tonight.
- [ ] ChromeOS **Settings → Device → Power**: while charging, set it to keep the display on.
      The booth also asks Chrome to keep the screen awake.

### Set up at the venue

- [ ] Plug in the Chromebook's charger.
- [ ] Connect the SELPHY to Wi-Fi. If it uses its own access point, join the Chromebook to it.
      The booth needs no internet once **offline ready** shows.
- [ ] Add the printer: ChromeOS **Settings → Advanced → Print and scan → Printers**.
      The CP1500 should appear on its own (AirPrint / IPP Everywhere). Save it.
- [ ] Load the paper and ink (KP-108IN). The paper tray takes up to 18 sheets, and each
      ink cassette prints 36, so refill around every 18 and 36 sheets on the counter.
- [ ] Pocket 3: connect it to the Chromebook with USB-C and choose **Webcam** mode on its
      screen. Keep it **horizontal** (landscape); vertical mode sends a tall picture.
      Turn off face tracking if you don't want it to follow people.
- [ ] Open the booth (from the installed app, or by typing the URL; it loads offline) and go full screen.

### Checks before guests arrive

- [ ] **The Pocket 3 appears in the camera picker.** In the operator menu → Camera, the
      list shows a DJI / Osmo Pocket entry and the line under it names it with its
      resolution (for example `… · 1920×1080`). The first time, the booth picks it
      automatically. If it shows the built-in camera, choose the Pocket 3 in the list; the
      choice is remembered.
- [ ] **The preview matches the capture.** Hold up something with straight edges (a sheet
      of paper) so it touches the edges of the preview, then run a session. The photo that
      appears after the flash, and the same photo in the strip, should show exactly what the
      preview showed at the edges. On photo 4 the logo covers the bottom of the preview,
      exactly where it covers the printed photo. Mirroring: the preview is mirrored like a
      mirror, the saved photo is not (both can be changed in the menu).
- [ ] **The test print is not clipped at the edges.** Operator menu → **Test print**. The
      sheet has a black line on the paper edge, then magenta, teal and yellow lines at 1, 2
      and 3 mm. Whatever is missing on paper was cropped by the printer.
      - Black line visible on all four sides: nothing is cut. Done.
      - Black (or black and magenta) missing: the printer crops about that much from each
        side, so the frame's outer edge gets trimmed. If that matters, set **Safety
        margin** to 1–2 % and print the test again.
      - White borders on paper, or the preview looks scaled: try **Page size → 100×148 mm**.
- [ ] **The print dialog defaults to 4×6.** Run a session and tap **Print**. Chrome's dialog
      should show Destination **Canon SELPHY CP1500**, Paper size **4 × 6 in / Postcard
      (100 × 148 mm)**, Margins **Default** or **None**, Scale **Default**, 1 page, and a
      preview with the two strips filling the page. If anything differs, fix it once; Chrome
      remembers the last settings for this printer.
- [ ] **A double tap on Print does not send two jobs.** Tap the booth's **Print** twice
      quickly. Only one Chrome print dialog should open, and after printing the button reads
      **Ready in 59s**. Check that only one job arrives (ChromeOS shows print jobs in the
      status area, or open the **Print jobs** app).
- [ ] Unplug the Pocket 3 for a moment: a **Camera disconnected** screen appears. Plug it
      back in and the booth returns by itself.

### During the event

- Guests: **Take photos** (or Space / Enter) → 4 photos → **Print**, **Retake a photo** (then tap
  the photo), **Filters**, **Save a copy**, or **Start over**. The review screen resets after 90 s
  of no activity.
- After Print, the button stays locked for 60 s while the SELPHY prints (about a minute per sheet).
- A print failed or jammed? Operator menu → **Saved sheets** → tap the sheet twice to reprint it.
- The counter shows sheets sent and sheets left in the 108-sheet pack. Use **−1** if a
  print dialog was cancelled.
- Camera trouble: the message screen has **Reconnect** (uses any camera, including the
  built-in one) and **Settings**.

### After the event

- [ ] Operator menu → **Clear all** to delete the saved sheets.
- [ ] Delete any `stkeyclub-*.png` files from the Chromebook's **Downloads** folder.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Camera blocked" | Click the camera icon in the address bar (or **Site settings**), set Camera to **Allow**, then tap **Retry**. |
| "Camera in use" | Close other tabs/apps using the camera (Meet, Camera app), then **Reconnect**. |
| Built-in camera instead of the Pocket 3 | Check that the Pocket 3 is in Webcam mode, then pick it in the operator menu. |
| Old version after deploying | Bump `VERSION` in `sw.js` and deploy again. The booth reloads into the new version the next time it is idle (or tap **Reload** in the operator menu). |
| Print preview shows white margins | Check Paper size in the dialog, or switch the booth's **Page size**. |
| Nothing works offline | Open the booth once with internet and wait for **offline ready** in the operator menu. |

## Tests

The tests need Node 18+, Playwright with Chromium, and poppler's `pdfinfo` / `pdftoppm`
for the PDF checks (`brew install poppler` or `apt install poppler-utils`).

```bash
npm install --no-save playwright
```

```bash
npx playwright install chromium
```

```bash
node tests/run.js
```

To run only part of the suite, pass part of a test name: `node tests/run.js print`.
They use Chromium's fake camera (`--use-fake-device-for-media-stream`
`--use-fake-ui-for-media-stream`) plus synthetic cameras for exact pixel checks.
Screenshots and PDFs go to `test-output/`.

What they check:

- **Frame:** hole detection returns the 4 measured boxes (and works at 2× resolution).
- **Sizes:** the strip is 600×1800 and the sheet is 1200×1800, with full-resolution crops.
- **Compositing:** every hole holds photo pixels, and all of 7,000+ sampled opaque logo pixels over hole 4 sit on top.
- **Preview:** the preview shows exactly the hole, with only the video mirrored.
- **Printing:** the print stylesheet gives one 4×6 in page edge to edge with both copies
  (`page.pdf` with `preferCSSPageSize`). The 100×148 mm page works too.
  A double tap is one job, and the lock and counter work.
- **Operator menu:** it opens and settings persist. The camera picker prefers DJI and
  remembers the camera even when Chrome changes its id.
- **Saved sheets:** reprint works and the last 20 are kept. Test print and idle reset work.
- **Errors:** denied, missing, hanging and unplugged cameras (including mid-countdown and
  during review) show a message, never a blank page, and recover.
- **Offline:** the booth loads and prints with the server stopped and the network off.
  A new version replaces the old cache, and Chrome reports the app installable.
- **Filters:** each filter works, None restores the originals exactly, and the fallback matches `ctx.filter`.
- **Layout:** every screen fits without scrolling, and the parts of each screen never overlap,
  from 320×568 phones to 1920×1080, upright and sideways. The flash doesn't fire again when
  the start screen comes back.

What they can't check is the real hardware: the Pocket 3, the SELPHY and Chrome's print
dialog. That's what the checklist above is for.
