// Test print: sample photos in the holes, plus guide lines 1, 2 and 3 mm from
// the paper edge so any cropping by the printer is easy to measure.
import { makeCanvas } from './util.js';

const PALETTES = [
  ['#ff4fa3', '#8a4dff'],
  ['#3ee6d4', '#2b59ff'],
  ['#ffb347', '#ff4f6d'],
  ['#9b5cff', '#3ee6d4'],
];

export function makeSamplePhotos(frame) {
  return frame.photoBoxes.map((b, i) => {
    const w = 1500;
    const h = Math.round((w * b.h) / b.w);
    const c = makeCanvas(w, h);
    const x = c.getContext('2d');
    const [a, z] = PALETTES[i % PALETTES.length];
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, a);
    g.addColorStop(1, z);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // grid
    x.strokeStyle = 'rgba(255,255,255,0.35)';
    x.lineWidth = 3;
    for (let k = 1; k < 8; k++) {
      x.beginPath();
      x.moveTo((w * k) / 8, 0);
      x.lineTo((w * k) / 8, h);
      x.stroke();
    }
    for (let k = 1; k < 6; k++) {
      x.beginPath();
      x.moveTo(0, (h * k) / 6);
      x.lineTo(w, (h * k) / 6);
      x.stroke();
    }
    // white border on the photo's own edge: shows how much of the photo is visible in the hole
    x.strokeStyle = '#ffffff';
    x.lineWidth = 10;
    x.strokeRect(5, 5, w - 10, h - 10);
    // big number and centre cross
    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `800 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
    x.fillText(String(i + 1), w / 2, h / 2);
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(w / 2 - 40, h / 2);
    x.lineTo(w / 2 + 40, h / 2);
    x.moveTo(w / 2, h / 2 - 40);
    x.lineTo(w / 2, h / 2 + 40);
    x.stroke();
    return c;
  });
}

// Draw guide lines on a sheet canvas: black at the very edge, then
// magenta / teal / yellow at 1 / 2 / 3 mm. Whatever is missing on paper was cropped.
export function addEdgeGuides(sheet) {
  const ctx = sheet.getContext('2d');
  const W = sheet.width;
  const H = sheet.height;
  const mm = W / 101.6; // the sheet is 4 in (101.6 mm) wide
  ctx.save();
  ctx.lineWidth = Math.max(2, Math.round(mm * 0.25));
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
  const marks = [
    [1, '#ff2d95'],
    [2, '#00d9c8'],
    [3, '#ffd400'],
  ];
  for (const [d, color] of marks) {
    const o = d * mm;
    ctx.strokeStyle = color;
    ctx.strokeRect(o, o, W - 2 * o, H - 2 * o);
  }
  // centre cut line ticks (top and bottom)
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, 6 * mm);
  ctx.moveTo(W / 2, H - 6 * mm);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  // legend
  const text = 'TEST PRINT · edge lines at 0 / 1 / 2 / 3 mm';
  ctx.font = `700 ${Math.round(mm * 2.6)}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const bw = tw + mm * 6;
  const bh = mm * 6;
  const bx = (W - bw) / 2;
  const by = H / 2 - bh / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
  ctx.restore();
  return sheet;
}
