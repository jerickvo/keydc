// STKEYCLUB Photo Booth – configuration.
// Most of these can be changed on the device in the operator menu (press "o"
// or hold the top-left corner for 2 seconds). Values here are the defaults.

export const CONFIG = {
  frameUrl: 'frame.png',
  shots: 4,

  // Hole boxes measured on the original 600x1800 frame (inclusive pixel ranges).
  // The app detects the holes automatically from frame.png's alpha channel.
  // These numbers are only used if detection does not find exactly 4 holes,
  // and they are scaled to the real size of frame.png.
  fallbackHoles: {
    refWidth: 600,
    refHeight: 1800,
    boxes: [
      { x1: 28, x2: 571, y1: 83, y2: 453 },
      { x1: 28, x2: 571, y1: 471, y2: 841 },
      { x1: 27, x2: 570, y1: 857, y2: 1226 },
      { x1: 27, x2: 570, y1: 1241, y2: 1610 },
    ],
  },
  holeAlphaThreshold: 16, // a pixel with alpha below this counts as transparent
  holeMinAreaFraction: 0.01, // ignore transparent specks smaller than 1% of the frame
  bleed: 2, // photos extend this many px (at 600 px frame width) past each hole edge

  camera: {
    width: 1920,
    height: 1080,
    // First run with no saved camera: prefer a device whose label contains one of these.
    preferLabels: ['dji', 'pocket', 'osmo'],
    startTimeoutMs: 10000,
    frozenAfterMs: 6000, // no new video frame for this long on the start screen = camera stalled
  },

  defaults: {
    mirrorPreview: true,
    mirrorPhoto: false,
    countdown: 3, // seconds
    pause: 1.5, // seconds the shot just taken stays on screen
    sound: true,
    flash: true,
    filters: true,
    layout: 'double', // 'double' = 2 copies per sheet, 'single' = 1 strip, other half blank
    printLock: 60, // seconds the Print button stays disabled after printing
    idleReset: 90, // seconds of no activity on the review screen before starting over
    pageSize: '4x6in', // '4x6in' or '100x148mm'
    printInset: 0, // percent of white safety margin around the sheet (0 = edge to edge)
    cameraId: '',
    cameraLabel: '',
  },

  paperPack: 108, // sheets in a Canon KP-108IN pack
  maxSessions: 20, // finished sheets kept on the device for reprinting
  printingScreenMs: 6000, // how long "Printing…" shows before the start screen returns
};
