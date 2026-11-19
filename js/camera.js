// Camera handling: picks the right device, survives unplugging, never hangs.
import { CONFIG } from '../config.js';

export class CameraError extends Error {
  constructor(kind, cause) {
    super(kind + (cause && cause.message ? ': ' + cause.message : ''));
    this.name = 'CameraError';
    this.kind = kind; // denied | notfound | busy | timeout | insecure | superseded | unknown
    this.cause = cause;
  }
}

export function classifyError(e) {
  if (e instanceof CameraError) return e.kind;
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'denied';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError') return 'notfound';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
  return 'unknown';
}

function stopStream(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }
}

export function matchesPreferred(label, preferLabels = CONFIG.camera.preferLabels) {
  const l = String(label || '').toLowerCase();
  return !!l && preferLabels.some((p) => l.includes(p));
}

export async function cameraPermissionState() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    const st = await navigator.permissions.query({ name: 'camera' });
    return st.state; // granted | denied | prompt
  } catch {
    return 'unknown';
  }
}

export class Camera extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.stream = null;
    this.track = null;
    this.deviceId = '';
    this.label = '';
    this.gen = 0;
    this.lastFrameAt = performance.now();
    this._rvfcHandle = null;
    this._lastTime = -1;
    this._onEnded = () => this._lost('ended');
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      // Fallback frame detector for browsers without requestVideoFrameCallback.
      setInterval(() => {
        const t = this.video.currentTime;
        if (t !== this._lastTime) {
          this._lastTime = t;
          this.lastFrameAt = performance.now();
        }
      }, 500);
    }
  }

  get running() {
    return !!(this.track && this.track.readyState === 'live');
  }

  get ready() {
    const v = this.video;
    return this.running && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
  }

  info() {
    return {
      deviceId: this.deviceId,
      label: this.label,
      width: this.video.videoWidth || 0,
      height: this.video.videoHeight || 0,
    };
  }

  msSinceFrame() {
    return performance.now() - this.lastFrameAt;
  }

  resetWatchdog() {
    this.lastFrameAt = performance.now();
  }

  async listCameras() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  // Start (or restart) the camera.
  //   deviceId / label: the saved choice. Tried first (by id, then by label).
  //   strict: only try the saved choice, never fall back to another camera.
  // Resolves with info(); `autoPicked` is true when a DJI/Pocket camera was chosen automatically.
  async start({ deviceId = '', label = '', strict = false, onPrompt = null } = {}) {
    const gen = ++this.gen;
    this.stop();
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) throw new CameraError('insecure');

    const perm = await cameraPermissionState();
    if (gen !== this.gen) throw new CameraError('superseded');
    // While the browser is asking for permission, never time out.
    const timeoutMs = perm === 'granted' ? CONFIG.camera.startTimeoutMs : 0;
    if (perm === 'prompt' && onPrompt) onPrompt();

    const cams = await this.listCameras();
    const plan = [];
    const add = (id) => {
      if (id && !plan.includes(id)) plan.push(id);
    };
    add(deviceId);
    if (label) {
      const byLabel = cams.find((c) => c.label && c.label === label);
      if (byLabel) add(byLabel.deviceId);
    }
    const nothingSaved = !deviceId && !label;
    let autoPicked = false;
    if (nothingSaved) {
      const pref = cams.find((c) => matchesPreferred(c.label));
      if (pref) {
        add(pref.deviceId);
        autoPicked = true;
      }
    }
    if (!strict) plan.push(null); // null = the browser's default camera
    if (!plan.length) throw new CameraError('notfound');

    let stream = null;
    let usedId = undefined;
    let lastErr = null;
    for (const id of plan) {
      try {
        stream = await this._open(id, timeoutMs);
        usedId = id;
        break;
      } catch (e) {
        lastErr = e;
        if (gen !== this.gen) throw new CameraError('superseded');
        if (classifyError(e) === 'denied') break; // permission applies to every camera
      }
    }
    if (gen !== this.gen) {
      stopStream(stream);
      throw new CameraError('superseded');
    }
    if (!stream) throw new CameraError(lastErr ? classifyError(lastErr) : 'notfound', lastErr);
    if (usedId === null) autoPicked = false;

    // First run: labels are hidden until permission is granted, so look for a
    // DJI/Pocket camera again now that we can see the names.
    if (nothingSaved && !strict && usedId === null) {
      const activeId = this._trackDeviceId(stream);
      const pref = (await this.listCameras()).find((c) => matchesPreferred(c.label));
      if (pref && pref.deviceId !== activeId) {
        stopStream(stream);
        stream = null;
        try {
          stream = await this._open(pref.deviceId, CONFIG.camera.startTimeoutMs);
          autoPicked = true;
        } catch {
          stream = await this._open(null, CONFIG.camera.startTimeoutMs).catch((e) => {
            throw new CameraError(classifyError(e), e);
          });
        }
      } else if (pref) {
        autoPicked = true;
      }
      if (gen !== this.gen) {
        stopStream(stream);
        throw new CameraError('superseded');
      }
    }

    await this._attach(stream, gen);
    return { ...this.info(), autoPicked };
  }

  _trackDeviceId(stream) {
    const t = stream && stream.getVideoTracks()[0];
    const s = t && t.getSettings ? t.getSettings() : {};
    return s.deviceId || '';
  }

  _open(deviceId, timeoutMs) {
    const video = {
      width: { ideal: CONFIG.camera.width },
      height: { ideal: CONFIG.camera.height },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    const p = navigator.mediaDevices.getUserMedia({ video, audio: false });
    if (!timeoutMs) return p;
    return new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => {
        done = true;
        reject(new CameraError('timeout'));
        p.then(stopStream, () => {}); // clean up if it answers late
      }, timeoutMs);
      p.then(
        (s) => {
          if (done) return;
          clearTimeout(t);
          resolve(s);
        },
        (e) => {
          if (done) return;
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  async _attach(stream, gen) {
    const v = this.video;
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopStream(stream);
      throw new CameraError('notfound');
    }
    this.stream = stream;
    this.track = track;
    track.addEventListener('ended', this._onEnded);
    this.deviceId = this._trackDeviceId(stream);
    this.label = track.label || '';
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    const playing = v.play();
    if (playing && playing.catch) playing.catch(() => {});
    try {
      await waitForVideo(v, 10000);
    } catch (e) {
      if (gen === this.gen) this.stop();
      throw new CameraError(gen === this.gen ? 'timeout' : 'superseded', e);
    }
    if (gen !== this.gen) throw new CameraError('superseded');
    this._watchFrames();
    this.lastFrameAt = performance.now();
  }

  _watchFrames() {
    const v = this.video;
    if (!('requestVideoFrameCallback' in v)) return;
    if (this._rvfcHandle !== null && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this._rvfcHandle);
    const cb = () => {
      this.lastFrameAt = performance.now();
      this._rvfcHandle = v.requestVideoFrameCallback(cb);
    };
    this._rvfcHandle = v.requestVideoFrameCallback(cb);
  }

  stop() {
    const s = this.stream;
    if (this.track) this.track.removeEventListener('ended', this._onEnded);
    this.stream = null;
    this.track = null;
    stopStream(s);
    try {
      this.video.srcObject = null;
    } catch {
      /* ignore */
    }
  }

  // Called when the camera goes away (unplugged, track ended, or stalled).
  markLost(reason) {
    this._lost(reason);
  }

  _lost(reason) {
    if (!this.stream) return;
    this.gen++; // invalidate any start() in flight
    this.stop();
    this.dispatchEvent(new CustomEvent('lost', { detail: { reason } }));
  }
}

function waitForVideo(v, ms) {
  return new Promise((resolve, reject) => {
    const ok = () => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
    if (ok()) {
      resolve();
      return;
    }
    const events = ['loadeddata', 'loadedmetadata', 'canplay', 'playing', 'resize'];
    const check = () => {
      if (ok()) {
        cleanup();
        resolve();
      }
    };
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('video did not start'));
    }, ms);
    const iv = setInterval(check, 200);
    function cleanup() {
      clearTimeout(t);
      clearInterval(iv);
      for (const e of events) v.removeEventListener(e, check);
    }
    for (const e of events) v.addEventListener(e, check);
  });
}
