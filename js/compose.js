// Capturing, strip and sheet composition.
import { makeCanvas } from './util.js';

const EMPTY_HOLE = '#1b1724';

// Grab the current video frame, cropped around the centre to the box aspect,
// at the camera's full native resolution.
export function cropFromVideo(video, box, mirror = false) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('The camera has no picture yet');
  const aspect = box.w / box.h;
  let sw = vw;
  let sh = Math.round(vw / aspect);
  if (sh > vh) {
    sh = vh;
    sw = Math.round(vh * aspect);
  }
  const sx = Math.floor((vw - sw) / 2);
  const sy = Math.floor((vh - sh) / 2);
  const c = makeCanvas(sw, sh);
  const ctx = c.getContext('2d');
  if (mirror) {
    ctx.translate(sw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

// Draw src into the destination box with a "cover" fit (fills the box, crops the overflow).
export function drawCover(ctx, src, dx, dy, dw, dh) {
  const iw = src.width || src.videoWidth || src.naturalWidth;
  const ih = src.height || src.videoHeight || src.naturalHeight;
  if (!iw || !ih || dw <= 0 || dh <= 0) return;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Photos go into the holes (expanded by the bleed), the frame is drawn on top.
//   photos: array of canvases (or null for an empty hole)
//   scale:  output size relative to the frame's own pixel size
//   drawPhoto(ctx, photo, x, y, w, h): optional hook used by filters
export function composeStrip(frame, photos, { scale = 1, canvas = null, drawPhoto = null } = {}) {
  const W = Math.max(1, Math.round(frame.width * scale));
  const H = Math.max(1, Math.round(frame.height * scale));
  const c = canvas || makeCanvas(W, H);
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = EMPTY_HOLE;
  ctx.fillRect(0, 0, W, H);
  const sx = W / frame.width;
  const sy = H / frame.height;
  frame.photoBoxes.forEach((b, i) => {
    const p = photos && photos[i];
    if (!p) return;
    const x = b.x * sx, y = b.y * sy, w = b.w * sx, h = b.h * sy;
    if (drawPhoto) drawPhoto(ctx, p, x, y, w, h);
    else drawCover(ctx, p, x, y, w, h);
  });
  ctx.drawImage(frame.image, 0, 0, W, H);
  ctx.restore();
  return c;
}

// The 4x6 print sheet: two copies of the strip side by side, so one cut down the
// middle gives two strips.
// The sheet is always 2:3. A strip that is not exactly 1:3 is fitted inside its half.
export function composeSheet(strip, { inset = 0 } = {}) {
  const cellW = strip.width;
  const cellH = Math.round(cellW * 3);
  const W = cellW * 2;
  const H = cellH;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Optional safety margin (percent of the sheet) for printers that crop the edges.
  const m = Math.max(0, Math.min(10, inset)) / 100;
  const ox = W * m;
  const oy = H * m;
  const innerW = W - 2 * ox;
  const innerH = H - 2 * oy;
  const half = innerW / 2;
  const fit = Math.min(half / strip.width, innerH / strip.height);
  const dw = strip.width * fit;
  const dh = strip.height * fit;
  const dy = oy + (innerH - dh) / 2;
  for (const k of [0, 1]) {
    const dx = ox + k * half + (half - dw) / 2;
    ctx.drawImage(strip, dx, dy, dw, dh);
  }
  return c;
}
