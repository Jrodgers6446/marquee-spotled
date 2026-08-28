import {
  LedConnection, Effect, ScreenMode, ColorDepth, FrameData,
} from './protocol.js';

/* ============================== helpers ============================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function makeGrid(w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(new Array(w).fill(0));
  return rows;
}

function cloneGrid(grid) { return grid.map((row) => row.slice()); }

function gridToMonoRows(grid) {
  return grid.map((row) => row.map((v) => (v ? '1' : '.')).join(''));
}

function gridToRgbBitmap(grid, color) {
  const out = [];
  for (const row of grid) {
    for (const v of row) {
      if (v) out.push(color[0], color[1], color[2]);
      else out.push(0, 0, 0);
    }
  }
  return new Uint8Array(out);
}

function monoRowsToBitmap(rows) {
  const out = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const ch = row[i + b];
        byte |= (ch === '1' ? 1 : 0) << (7 - b);
      }
      out.push(byte);
    }
  }
  return new Uint8Array(out);
}

function padRowsToMultipleOf8(rows) {
  const w = rows[0].length;
  const padded = w % 8 === 0 ? w : w + (8 - (w % 8));
  return rows.map((r) => r + '.'.repeat(padded - r.length));
}

function frameFromGrid(grid, colorDepth, color) {
  const w = grid[0].length, h = grid.length;
  if (colorDepth === ColorDepth.RGB) {
    return new FrameData(w, h, gridToRgbBitmap(grid, color), FrameData.RGB);
  }
  const rows = padRowsToMultipleOf8(gridToMonoRows(grid));
  return new FrameData(w, h, monoRowsToBitmap(rows), FrameData.MONO);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ==================== canvas text -> pixel grid rows ==================== */

// Renders text (possibly multi-line) into a boolean pixel matrix of
// arbitrary width x deviceHeight, returning {grid, colorGrid} where colorGrid
// holds [r,g,b] per lit pixel (only meaningful for RGB devices).
function rasterizeText(text, deviceHeight, colorRgb) {
  const safeHeight = (Number.isFinite(deviceHeight) && deviceHeight > 0) ? deviceHeight : 12;
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  const n = Math.max(1, lines.length);
  const lineHeight = Math.max(5, Math.floor(safeHeight / n));
  const fontPx = Math.max(4, lineHeight - 1);

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `bold ${fontPx}px "Courier New", monospace`;
  let maxWidth = 1;
  const widths = lines.map((l) => Math.max(1, Math.ceil(mctx.measureText(l).width) + 2));
  maxWidth = Math.max(...widths, 1);

  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = n * lineHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${fontPx}px "Courier New", monospace`;
  lines.forEach((line, i) => {
    ctx.fillText(line, 1, i * lineHeight + Math.floor((lineHeight - fontPx) / 2));
  });

  // if fewer pixel rows than deviceHeight (single short line), letterbox-center vertically
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = maxWidth;
  finalCanvas.height = safeHeight;
  const fctx = finalCanvas.getContext('2d');
  fctx.fillStyle = '#000';
  fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  const yOffset = Math.max(0, Math.floor((safeHeight - canvas.height) / 2));
  fctx.drawImage(canvas, 0, yOffset);

  const imgData = fctx.getImageData(0, 0, maxWidth, safeHeight).data;
  const grid = [];
  for (let y = 0; y < safeHeight; y++) {
    const row = [];
    for (let x = 0; x < maxWidth; x++) {
      const idx = (y * maxWidth + x) * 4;
      const lum = (imgData[idx] + imgData[idx + 1] + imgData[idx + 2]) / 3;
      row.push(lum > 90 ? 1 : 0);
    }
    grid.push(row);
  }
  return grid;
}

// Chops a wide grid into device-width frames (left to right), padding the
// last one with blank columns.
function chopIntoFrames(grid, frameWidth) {
  const h = grid.length, totalW = grid[0].length;
  const frames = [];
  for (let x = 0; x < totalW; x += frameWidth) {
    const frame = [];
    for (let y = 0; y < h; y++) {
      const row = grid[y].slice(x, x + frameWidth);
      while (row.length < frameWidth) row.push(0);
      frame.push(row);
    }
    frames.push(frame);
  }
  return frames;
}

/* ============================== LED-style renderer ============================== */

function drawLedGrid(canvas, grid, { color = '#ffb000', bg = '#0b0d0f', editable = false } = {}) {
  const ctx = canvas.getContext('2d');
  const h = grid.length, w = grid[0].length;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);

  const pad = 4;
  const cellW = (cssW - pad * 2) / w;
  const cellH = (cssH - pad * 2) / h;
  const r = Math.max(1, Math.min(cellW, cellH) * 0.38);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = pad + cellW * x + cellW / 2;
      const cy = pad + cellH * y + cellH / 2;
      const on = grid[y][x];
      const cellColor = Array.isArray(on) ? `rgb(${on[0]},${on[1]},${on[2]})` : color;
      if (on) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
        glow.addColorStop(0, cellColor);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cellColor;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (editable) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function attachGridPainter(canvas, grid, onPaint, colorProvider, onStrokeEnd) {
  let painting = false;
  let paintValue = 1;
  const cellFromEvent = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * grid[0].length;
    const y = ((ev.clientY - rect.top) / rect.height) * grid.length;
    return { gx: Math.floor(x), gy: Math.floor(y) };
  };
  const paint = (ev, start) => {
    const { gx, gy } = cellFromEvent(ev);
    if (gx < 0 || gy < 0 || gx >= grid[0].length || gy >= grid.length) return;
    if (start) {
      const current = grid[gy][gx];
      paintValue = current ? 0 : (colorProvider ? colorProvider() : 1);
    }
    grid[gy][gx] = paintValue;
    onPaint();
  };
  canvas.addEventListener('pointerdown', (ev) => { painting = true; paint(ev, true); });
  window.addEventListener('pointerup', () => {
    if (painting && onStrokeEnd) onStrokeEnd();
    painting = false;
  });
  canvas.addEventListener('pointermove', (ev) => { if (painting) paint(ev, false); });
  canvas.addEventListener('pointerleave', () => { painting = false; });
}

/* ---- shared undo/redo history + image import + frame-shift helpers ---- */
/* Ported feature-for-feature from spotled-gui's editor (drawing tools with
   undo/redo, PNG import, whole-frame shifting), rebuilt against Marquee's
   own Web Bluetooth grid/frame model rather than spotled-gui's Python/Qt
   code, which can't run in a browser. */

class UndoStack {
  constructor(maxSize = 50) { this.stack = []; this.index = -1; this.maxSize = maxSize; }
  push(grid) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(cloneGrid(grid));
    if (this.stack.length > this.maxSize) this.stack.shift();
    this.index = this.stack.length - 1;
  }
  undo() {
    if (this.index <= 0) return null;
    this.index--;
    return cloneGrid(this.stack[this.index]);
  }
  redo() {
    if (this.index >= this.stack.length - 1) return null;
    this.index++;
    return cloneGrid(this.stack[this.index]);
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
  reset(grid) { this.stack = [cloneGrid(grid)]; this.index = 0; }
}

// Replaces a grid's contents in place (same object reference), so any
// painter already bound to that grid stays valid without re-attaching.
function setGridContents(grid, newGrid) {
  for (let y = 0; y < grid.length; y++) {
    grid[y] = newGrid[y].slice();
  }
}

// Shifts a grid's contents by (dx, dy) cells, wrapping around the edges.
function shiftGrid(grid, dx, dy) {
  const h = grid.length, w = grid[0].length;
  const shifted = makeGrid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = ((x - dx) % w + w) % w;
      const sy = ((y - dy) % h + h) % h;
      shifted[y][x] = grid[sy][sx];
    }
  }
  setGridContents(grid, shifted);
}

// Loads an image file, scales it to fit the grid's exact dimensions, and
// thresholds it to on/off pixels (using the currently selected accent
// color for "on" pixels on RGB devices) -- a browser-based equivalent of
// spotled-gui's "PNG monochrome image importing" feature.
function importImageToGrid(file, grid, isRgb, onColor, callback) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const w = grid[0].length, h = grid.length;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx = off.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h); // stretch-fit to exact device size
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          const on = lum > 90;
          grid[y][x] = on ? (isRgb ? onColor : 1) : 0;
        }
      }
      callback();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ============================== app state ============================== */

const conn = new LedConnection();
let statusTimer = null;

function setStatus(msg, kind = 'info') {
  const el = $('#status');
  el.textContent = msg;
  el.dataset.kind = kind;
  clearTimeout(statusTimer);
  if (kind !== 'error') statusTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

function currentColor() {
  return hexToRgb($('#accentColor').value);
}

function updateDeviceInfoPanel() {
  $('#devDims').textContent = `${conn.width} × ${conn.height}`;
  $('#devColor').textContent = conn.colorDepth === ColorDepth.RGB ? 'RGB' : 'Monochrome';
  $('#devFrameLimit').textContent = conn.frameLimit;
  $('#devBuffer').textContent = conn.bufferSize;
  $('#devVersion').textContent = conn.version
    ? `type ${conn.version.deviceType} · rev ${conn.version.deviceRevision} · fw ${conn.version.softwareRevision}`
    : '—';
  $('#brightness').value = conn.brightness;
  $('#brightnessVal').textContent = conn.brightness;
  $('#accentColor').closest('.field').style.display = conn.colorDepth === ColorDepth.RGB ? '' : 'none';
}

function setConnectedUI(isConnected) {
  document.body.classList.toggle('connected', isConnected);
  $('#connectBtn').textContent = isConnected ? 'Disconnect' : 'Connect display';
  $$('.needs-connection').forEach((el) => { el.disabled = !isConnected; });
}

async function handleConnectClick(acceptAll = false) {
  if (conn.isConnected) {
    conn.disconnect();
    return;
  }
  if (!navigator.bluetooth) {
    setStatus('Web Bluetooth isn\u2019t available in this browser. Try Chrome or Edge on desktop/Android.', 'error');
    return;
  }
  $('#connectFallback').hidden = true;
  try {
    setStatus(acceptAll
      ? 'Showing all nearby Bluetooth devices\u2026'
      : 'Choose your SpotLED display in the browser prompt\u2026');
    await conn.connect(acceptAll);
    updateDeviceInfoPanel();
    setConnectedUI(true);
    setStatus(`Connected \u2014 ${conn.width}\u00d7${conn.height} display.`);
    rebuildEditorsForDevice();
  } catch (err) {
    console.error('SpotLED connect failed:', err);
    let msg = err.message || 'Could not connect to the display.';
    if (err.name === 'NotFoundError') {
      msg = acceptAll
        ? 'No device was selected. Make sure the display is powered on and in range.'
        : 'No device matched "SpotLED\u2026" \u2014 it may use a different name.';
      if (!acceptAll) $('#connectFallback').hidden = false;
    } else if (err.name === 'NetworkError') {
      msg = 'Bluetooth connection dropped (GATT server unreachable). Try moving closer or power-cycling the display.';
    } else if (err.name === 'SecurityError') {
      msg = 'Blocked by browser security policy \u2014 this page must be served over HTTPS.';
    } else if (/service/i.test(msg) || /GATT Service.*not found/i.test(msg)) {
      msg = `Connected, but the expected SpotLED service (${err.message}) wasn\u2019t found on this device \u2014 it may use a different protocol/board revision.`;
    }
    setStatus(msg, 'error');
  }
}

conn.onDisconnect = () => {
  setConnectedUI(false);
  setStatus('Display disconnected.');
};

/* ============================== brightness / screen mode ============================== */

let brightnessDebounce = null;
$('#brightness').addEventListener('input', (ev) => {
  $('#brightnessVal').textContent = ev.target.value;
  clearTimeout(brightnessDebounce);
  brightnessDebounce = setTimeout(async () => {
    try { await conn.setBrightness(Number(ev.target.value)); }
    catch (err) { setStatus(err.message, 'error'); }
  }, 120);
});

$('#brightnessTest').addEventListener('click', async () => {
  setStatus('Setting brightness to 30, then asking the device what it thinks its brightness is\u2026');
  try {
    const before = conn.brightness;
    const reported = await conn.setBrightnessAndVerify(30);
    if (reported === 30) {
      setStatus(`Device confirms brightness=30 internally (was ${before}). The write command IS accepted \u2014 if the screen didn't visibly change, the issue is elsewhere (e.g. frame/text rendering), not this command.`);
    } else {
      setStatus(`Sent 30, but device reports brightness=${reported} \u2014 the write is NOT taking effect internally. This command's opcode is likely wrong for this firmware.`, 'error');
    }
  } catch (err) {
    setStatus(`Test failed: ${err.message}`, 'error');
  }
});

$$('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    $$('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    try { await conn.setScreenMode(ScreenMode[btn.dataset.mode]); }
    catch (err) { setStatus(err.message, 'error'); }
  });
});

/* ============================== tabs ============================== */

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#panel-${btn.dataset.tab}`).classList.add('active');
  });
});

/* ============================== draw tab ============================== */

let drawGrid = makeGrid(48, 12);
const drawHistory = new UndoStack();

function renderDraw() {
  drawLedGrid($('#drawCanvas'), drawGrid, { color: $('#accentColor').value, editable: true });
  updateDrawUndoButtons();
}

function updateDrawUndoButtons() {
  $('#drawUndo').disabled = !drawHistory.canUndo();
  $('#drawRedo').disabled = !drawHistory.canRedo();
}

function setupDrawTab() {
  drawGrid = makeGrid(conn.width || 48, conn.height || 12);
  drawHistory.reset(drawGrid);
  renderDraw();
  attachGridPainter($('#drawCanvas'), drawGrid, renderDraw, () =>
    (conn.colorDepth === ColorDepth.RGB ? currentColor() : 1),
    () => drawHistory.push(drawGrid));
}

$('#drawUndo').addEventListener('click', () => {
  const prev = drawHistory.undo();
  if (prev) { setGridContents(drawGrid, prev); renderDraw(); }
});
$('#drawRedo').addEventListener('click', () => {
  const next = drawHistory.redo();
  if (next) { setGridContents(drawGrid, next); renderDraw(); }
});
$('#drawClear').addEventListener('click', () => {
  setGridContents(drawGrid, makeGrid(drawGrid[0].length, drawGrid.length));
  drawHistory.push(drawGrid);
  renderDraw();
});
$('#drawInvert').addEventListener('click', () => {
  setGridContents(drawGrid, drawGrid.map((row) => row.map((v) => (v ? 0 : 1))));
  drawHistory.push(drawGrid);
  renderDraw();
});
$('#drawShiftLeft').addEventListener('click', () => { shiftGrid(drawGrid, -1, 0); drawHistory.push(drawGrid); renderDraw(); });
$('#drawShiftRight').addEventListener('click', () => { shiftGrid(drawGrid, 1, 0); drawHistory.push(drawGrid); renderDraw(); });
$('#drawShiftUp').addEventListener('click', () => { shiftGrid(drawGrid, 0, -1); drawHistory.push(drawGrid); renderDraw(); });
$('#drawShiftDown').addEventListener('click', () => { shiftGrid(drawGrid, 0, 1); drawHistory.push(drawGrid); renderDraw(); });
$('#drawImportPng').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  importImageToGrid(file, drawGrid, conn.colorDepth === ColorDepth.RGB, currentColor(), () => {
    drawHistory.push(drawGrid);
    renderDraw();
  });
  ev.target.value = ''; // allow re-importing the same file later
});
$('#drawSend').addEventListener('click', async () => {
  try {
    const frame = frameFromGrid(drawGrid, conn.colorDepth, currentColor());
    await conn.sendFrames([frame], 1000, 0, Effect.NONE);
    setStatus('Frame sent.');
  } catch (err) { setStatus(err.message, 'error'); }
});

/* ============================== text tab ============================== */

$('#textSend').addEventListener('click', async () => {
  if (!conn.isConnected) return;
  const text = $('#textInput').value;
  if (!text.trim()) { setStatus('Type something first.', 'error'); return; }
  const effect = Effect[$('#textEffect').value];
  const speed = Number($('#textSpeed').value);
  const frameMs = Number($('#textFrameMs').value);
  const deviceHeight = conn.height || 12;
  const deviceWidth = conn.width || 48;
  if (!conn.height || !conn.width) {
    setStatus('Device dimensions haven\u2019t loaded yet \u2014 try reconnecting.', 'error');
    return;
  }
  try {
    const grid = rasterizeText(text, deviceHeight, currentColor());
    const frames = chopIntoFrames(grid, deviceWidth).map((g) =>
      frameFromGrid(g, conn.colorDepth, currentColor()));
    if (frames.length > conn.frameLimit) {
      setStatus(`Text is too long \u2014 needs ${frames.length} frames but the device allows ${conn.frameLimit}. Shorten it.`, 'error');
      return;
    }
    await conn.sendFrames(frames, frameMs, speed, effect);
    setStatus(`Sent (${frames.length} frame${frames.length > 1 ? 's' : ''}).`);
  } catch (err) { setStatus(err.message, 'error'); }
});

$('#textSpeed').addEventListener('input', (ev) => { $('#textSpeedVal').textContent = ev.target.value; });
$('#textFrameMs').addEventListener('input', (ev) => { $('#textFrameMsVal').textContent = ev.target.value; });

$('#textPreview').addEventListener('click', () => {
  const text = $('#textInput').value || 'HELLO';
  const h = conn.height || 12;
  const w = conn.width || 48;
  const grid = rasterizeText(text, h, currentColor());
  const preview = grid.map((row) => row.slice(0, w));
  drawLedGrid($('#textPreviewCanvas'), preview.length ? preview : makeGrid(w, h),
    { color: $('#accentColor').value });
});

/* ============================== animate tab ============================== */

let animFrames = [makeGrid(48, 12)];
let animActiveIndex = 0;
let animPlaying = false;
let animPlayTimer = null;
const animHistory = new UndoStack();

function renderAnimEditor() {
  drawLedGrid($('#animCanvas'), animFrames[animActiveIndex], { color: $('#accentColor').value, editable: true });
  renderAnimFilmstrip();
  updateAnimUndoButtons();
}

function updateAnimUndoButtons() {
  $('#animUndo').disabled = !animHistory.canUndo();
  $('#animRedo').disabled = !animHistory.canRedo();
}

function renderAnimFilmstrip() {
  const strip = $('#animFilmstrip');
  strip.innerHTML = '';
  animFrames.forEach((frame, i) => {
    const thumb = document.createElement('canvas');
    thumb.className = 'anim-thumb' + (i === animActiveIndex ? ' active' : '');
    thumb.width = 96; thumb.height = 96;
    thumb.style.width = '48px'; thumb.style.height = '48px';
    strip.appendChild(thumb);
    drawLedGrid(thumb, frame, { color: $('#accentColor').value });
    thumb.addEventListener('click', () => {
      animActiveIndex = i;
      animHistory.reset(animFrames[animActiveIndex]);
      rebindAnimPainter();
      renderAnimEditor();
    });
  });
}

function setupAnimTab() {
  const w = conn.width || 48, h = conn.height || 12;
  animFrames = [makeGrid(w, h)];
  animActiveIndex = 0;
  animHistory.reset(animFrames[animActiveIndex]);
  renderAnimEditor();
  attachGridPainter($('#animCanvas'), animFrames[animActiveIndex], renderAnimEditor, () =>
    (conn.colorDepth === ColorDepth.RGB ? currentColor() : 1),
    () => animHistory.push(animFrames[animActiveIndex]));
}

$('#animAdd').addEventListener('click', () => {
  const w = animFrames[0][0].length, h = animFrames[0].length;
  animFrames.splice(animActiveIndex + 1, 0, makeGrid(w, h));
  animActiveIndex += 1;
  animHistory.reset(animFrames[animActiveIndex]);
  rebindAnimPainter();
  renderAnimEditor();
});
$('#animDuplicate').addEventListener('click', () => {
  animFrames.splice(animActiveIndex + 1, 0, cloneGrid(animFrames[animActiveIndex]));
  animActiveIndex += 1;
  animHistory.reset(animFrames[animActiveIndex]);
  rebindAnimPainter();
  renderAnimEditor();
});
$('#animDelete').addEventListener('click', () => {
  if (animFrames.length <= 1) return;
  animFrames.splice(animActiveIndex, 1);
  animActiveIndex = Math.max(0, animActiveIndex - 1);
  animHistory.reset(animFrames[animActiveIndex]);
  rebindAnimPainter();
  renderAnimEditor();
});
$('#animClear').addEventListener('click', () => {
  const w = animFrames[0][0].length, h = animFrames[0].length;
  setGridContents(animFrames[animActiveIndex], makeGrid(w, h));
  animHistory.push(animFrames[animActiveIndex]);
  renderAnimEditor();
});
$('#animUndo').addEventListener('click', () => {
  const prev = animHistory.undo();
  if (prev) { setGridContents(animFrames[animActiveIndex], prev); renderAnimEditor(); }
});
$('#animRedo').addEventListener('click', () => {
  const next = animHistory.redo();
  if (next) { setGridContents(animFrames[animActiveIndex], next); renderAnimEditor(); }
});
$('#animShiftLeft').addEventListener('click', () => { shiftGrid(animFrames[animActiveIndex], -1, 0); animHistory.push(animFrames[animActiveIndex]); renderAnimEditor(); });
$('#animShiftRight').addEventListener('click', () => { shiftGrid(animFrames[animActiveIndex], 1, 0); animHistory.push(animFrames[animActiveIndex]); renderAnimEditor(); });
$('#animShiftUp').addEventListener('click', () => { shiftGrid(animFrames[animActiveIndex], 0, -1); animHistory.push(animFrames[animActiveIndex]); renderAnimEditor(); });
$('#animShiftDown').addEventListener('click', () => { shiftGrid(animFrames[animActiveIndex], 0, 1); animHistory.push(animFrames[animActiveIndex]); renderAnimEditor(); });
$('#animImportPng').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  importImageToGrid(file, animFrames[animActiveIndex], conn.colorDepth === ColorDepth.RGB, currentColor(), () => {
    animHistory.push(animFrames[animActiveIndex]);
    renderAnimEditor();
  });
  ev.target.value = '';
});

function rebindAnimPainter() {
  const canvas = $('#animCanvas');
  const clone = canvas.cloneNode(true);
  canvas.replaceWith(clone);
  attachGridPainter(clone, animFrames[animActiveIndex], renderAnimEditor, () =>
    (conn.colorDepth === ColorDepth.RGB ? currentColor() : 1),
    () => animHistory.push(animFrames[animActiveIndex]));
}

$('#animPlay').addEventListener('click', () => {
  animPlaying = !animPlaying;
  $('#animPlay').textContent = animPlaying ? 'Stop preview' : 'Play preview';
  if (animPlaying) {
    let i = 0;
    const fps = Number($('#animFrameMs').value) || 200;
    animPlayTimer = setInterval(() => {
      i = (i + 1) % animFrames.length;
      drawLedGrid($('#animCanvas'), animFrames[i], { color: $('#accentColor').value, editable: true });
    }, fps);
  } else {
    clearInterval(animPlayTimer);
    renderAnimEditor();
  }
});

$('#animFrameMs').addEventListener('input', (ev) => { $('#animFrameMsVal').textContent = ev.target.value; });

$('#animSend').addEventListener('click', async () => {
  try {
    if (animFrames.length > conn.frameLimit) {
      setStatus(`Too many frames \u2014 device allows up to ${conn.frameLimit}.`, 'error');
      return;
    }
    const effect = Effect[$('#animEffect').value];
    const frameMs = Number($('#animFrameMs').value);
    const frames = animFrames.map((g) => frameFromGrid(g, conn.colorDepth, currentColor()));
    await conn.sendFrames(frames, frameMs, 0, effect);
    setStatus(`Animation sent (${frames.length} frames).`);
  } catch (err) { setStatus(err.message, 'error'); }
});

/* ============================== bars tab ============================== */

function setupBarsTab() {
  const wrap = $('#barsSliders');
  wrap.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const input = document.createElement('input');
    input.type = 'range'; input.min = 0; input.max = 12; input.value = 0;
    input.orient = 'vertical';
    input.className = 'bar-slider';
    input.dataset.index = i;
    input.addEventListener('input', renderBarsPreview);
    wrap.appendChild(input);
  }
  renderBarsPreview();
}

function renderBarsPreview() {
  const sliders = $$('.bar-slider');
  const grid = makeGrid(16, 13);
  sliders.forEach((s, i) => {
    const v = Number(s.value);
    for (let y = 0; y <= v; y++) grid[12 - y][i] = 1;
  });
  drawLedGrid($('#barsCanvas'), grid, { color: $('#accentColor').value });
}

$('#barsSend').addEventListener('click', async () => {
  const values = $$('.bar-slider').map((s) => Number(s.value));
  try {
    await conn.sendNumberBar(values);
    setStatus('Bar levels sent.');
  } catch (err) { setStatus(err.message, 'error'); }
});
$('#barsRandom').addEventListener('click', () => {
  $$('.bar-slider').forEach((s) => { s.value = Math.floor(Math.random() * 13); });
  renderBarsPreview();
});

/* ============================== boot ============================== */

function rebuildEditorsForDevice() {
  setupDrawTab();
  setupAnimTab();
  setupBarsTab();
}

$('#connectBtn').addEventListener('click', () => handleConnectClick(false));
$('#connectFallback').addEventListener('click', () => handleConnectClick(true));
$('#accentColor').addEventListener('input', () => {
  renderDraw(); renderAnimEditor(); renderBarsPreview();
});

setConnectedUI(false);
setupDrawTab();
setupAnimTab();
setupBarsTab();

if (!navigator.bluetooth) {
  setStatus('Web Bluetooth isn\u2019t supported in this browser. Use Chrome or Edge on desktop or Android.', 'error');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
