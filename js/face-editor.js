/**
 * 2D Face Editor overlay.
 * Allows adding shapes (rect, circle, star, text) on a polygon face,
 * with drag/scale/rotate handles, and cut/engrave mode selection.
 */
import { setFaceDecoration, rebuild } from './poly-main.js';

let overlay, editorCanvas, ctx;
let currentFaceIndex = -1;
let faceVerts2D = [];
let decorations = [];
let selectedIndex = -1;
let activeTool = null;
let solidType = '';

// Canvas coordinate transform
let scale = 1;
let offsetX = 0;
let offsetY = 0;

// Drag state
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigX = 0;
let dragOrigY = 0;

export function initFaceEditor() {
  overlay = document.getElementById('faceEditorOverlay');
  editorCanvas = document.getElementById('editorCanvas');
  ctx = editorCanvas.getContext('2d');

  document.getElementById('editorClose').addEventListener('click', closeFaceEditor);

  // Tool buttons
  const toolBtns = document.querySelectorAll('.editor-toolbar button');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'delete') {
        deleteSelected();
        return;
      }
      activeTool = activeTool === tool ? null : tool;
      toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === activeTool));
    });
  });

  editorCanvas.addEventListener('mousedown', onCanvasMouseDown);
  editorCanvas.addEventListener('mousemove', onCanvasMouseMove);
  editorCanvas.addEventListener('mouseup', onCanvasMouseUp);

  document.getElementById('applyDeco').addEventListener('click', applyToModel);

  // Property inputs sync
  ['decoPosX', 'decoPosY', 'decoSize', 'decoRotation', 'decoMode'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (selectedIndex < 0) return;
      syncPropsToDecoration();
      draw();
    });
  });
}

export function openFaceEditor(faceIndex, verts2D, existingDecorations, solidTypeName) {
  currentFaceIndex = faceIndex;
  faceVerts2D = verts2D;
  decorations = existingDecorations ? JSON.parse(JSON.stringify(existingDecorations)) : [];
  selectedIndex = -1;
  solidType = solidTypeName;

  document.getElementById('editorTitle').textContent =
    `面编辑器 — ${solidTypeName} 面 #${faceIndex}`;

  overlay.classList.remove('hidden');

  // Size canvas properly
  const dpr = window.devicePixelRatio || 1;
  const rect = editorCanvas.getBoundingClientRect();
  editorCanvas.width = rect.width * dpr;
  editorCanvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  computeTransform(rect.width, rect.height);
  draw();
}

function closeFaceEditor() {
  overlay.classList.add('hidden');
  currentFaceIndex = -1;
}

function computeTransform(canvasW, canvasH) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of faceVerts2D) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const padding = 60;
  const polyW = maxX - minX;
  const polyH = maxY - minY;
  scale = Math.min((canvasW - padding * 2) / polyW, (canvasH - padding * 2) / polyH);
  offsetX = canvasW / 2 - ((minX + maxX) / 2) * scale;
  offsetY = canvasH / 2 + ((minY + maxY) / 2) * scale; // flip Y
}

function toCanvas(x, y) {
  return [x * scale + offsetX, -y * scale + offsetY];
}

function toModel(cx, cy) {
  return [(cx - offsetX) / scale, -(cy - offsetY) / scale];
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function draw() {
  const w = editorCanvas.getBoundingClientRect().width;
  const h = editorCanvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, w, h);

  drawPolygon();
  decorations.forEach((d, i) => drawDecoration(d, i === selectedIndex));

  updatePropsPanel();
}

function drawPolygon() {
  ctx.beginPath();
  const [sx, sy] = toCanvas(faceVerts2D[0][0], faceVerts2D[0][1]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < faceVerts2D.length; i++) {
    const [x, y] = toCanvas(faceVerts2D[i][0], faceVerts2D[i][1]);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(79, 195, 247, 0.05)';
  ctx.fill();
}

function drawDecoration(d, selected) {
  ctx.save();
  const color = d.mode === 'cut' ? 'rgba(229, 115, 115, 0.8)' : 'rgba(129, 199, 132, 0.8)';
  const fillColor = d.mode === 'cut' ? 'rgba(229, 115, 115, 0.2)' : 'rgba(129, 199, 132, 0.2)';

  switch (d.type) {
    case 'circle': {
      const [cx, cy] = toCanvas(d.cx, d.cy);
      const r = d.radius * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.stroke();
      ctx.fillStyle = fillColor;
      ctx.fill();
      if (selected) drawSelectionBox(cx - r, cy - r, r * 2, r * 2);
      break;
    }
    case 'rect': {
      const [cx, cy] = toCanvas(d.x, d.y);
      const w = d.width * scale;
      const h = d.height * scale;
      ctx.translate(cx, cy);
      if (d.rotation) ctx.rotate(-d.rotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = fillColor;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      if (selected) drawSelectionBox(-w / 2, -h / 2, w, h);
      break;
    }
    case 'star': {
      const [cx, cy] = toCanvas(d.cx, d.cy);
      const or = d.outerR * scale;
      const ir = (d.innerR || d.outerR * 0.4) * scale;
      const pts = d.points || 5;
      ctx.translate(cx, cy);
      if (d.rotation) ctx.rotate(-d.rotation);
      ctx.beginPath();
      for (let i = 0; i < pts * 2; i++) {
        const r = i % 2 === 0 ? or : ir;
        const angle = -Math.PI / 2 + (i * Math.PI) / pts;
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.stroke();
      ctx.fillStyle = fillColor;
      ctx.fill();
      if (selected) drawSelectionBox(-or, -or, or * 2, or * 2);
      break;
    }
    case 'text': {
      const [cx, cy] = toCanvas(d.x, d.y);
      const fontSize = (d.fontSize || 10) * scale;
      ctx.translate(cx, cy);
      if (d.rotation) ctx.rotate(-d.rotation);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.content || 'Text', 0, 0);
      const tw = ctx.measureText(d.content || 'Text').width;
      if (selected) drawSelectionBox(-tw / 2, -fontSize / 2, tw, fontSize);
      break;
    }
  }
  ctx.restore();
}

function drawSelectionBox(x, y, w, h) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  ctx.setLineDash([]);

  // Corner handles
  const handleSize = 6;
  ctx.fillStyle = '#4fc3f7';
  for (const [hx, hy] of [[x - 4, y - 4], [x + w + 4, y - 4], [x - 4, y + h + 4], [x + w + 4, y + h + 4]]) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }
}

// ── Interaction ─────────────────────────────────────────────────────────────

function onCanvasMouseDown(e) {
  const rect = editorCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const [mx, my] = toModel(cx, cy);

  if (activeTool) {
    addDecoration(activeTool, mx, my);
    activeTool = null;
    document.querySelectorAll('.editor-toolbar button').forEach(b => b.classList.remove('active'));
    draw();
    return;
  }

  // Hit test decorations (reverse order for z-order)
  selectedIndex = -1;
  for (let i = decorations.length - 1; i >= 0; i--) {
    if (hitTest(decorations[i], mx, my)) {
      selectedIndex = i;
      break;
    }
  }

  if (selectedIndex >= 0) {
    dragging = true;
    dragStartX = mx;
    dragStartY = my;
    const d = decorations[selectedIndex];
    dragOrigX = d.cx !== undefined ? d.cx : d.x;
    dragOrigY = d.cy !== undefined ? d.cy : d.y;
  }

  draw();
}

function onCanvasMouseMove(e) {
  if (!dragging || selectedIndex < 0) return;
  const rect = editorCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const [mx, my] = toModel(cx, cy);

  const dx = mx - dragStartX;
  const dy = my - dragStartY;
  const d = decorations[selectedIndex];

  if (d.cx !== undefined) {
    d.cx = dragOrigX + dx;
    d.cy = dragOrigY + dy;
  } else {
    d.x = dragOrigX + dx;
    d.y = dragOrigY + dy;
  }

  draw();
}

function onCanvasMouseUp() {
  dragging = false;
}

function hitTest(d, mx, my) {
  const margin = 3 / scale;
  switch (d.type) {
    case 'circle': {
      const dx = mx - d.cx;
      const dy = my - d.cy;
      return Math.hypot(dx, dy) <= d.radius + margin;
    }
    case 'rect': {
      const hw = d.width / 2 + margin;
      const hh = d.height / 2 + margin;
      let lx = mx - d.x;
      let ly = my - d.y;
      if (d.rotation) {
        const c = Math.cos(-d.rotation);
        const s = Math.sin(-d.rotation);
        const rx = lx * c - ly * s;
        const ry = lx * s + ly * c;
        lx = rx;
        ly = ry;
      }
      return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
    }
    case 'star': {
      const dx = mx - d.cx;
      const dy = my - d.cy;
      return Math.hypot(dx, dy) <= d.outerR + margin;
    }
    case 'text': {
      const charW = (d.fontSize || 10) * 0.6;
      const totalW = (d.content || 'Text').length * charW;
      const hw = totalW / 2 + margin;
      const hh = (d.fontSize || 10) / 2 + margin;
      return Math.abs(mx - d.x) <= hw && Math.abs(my - d.y) <= hh;
    }
  }
  return false;
}

function addDecoration(type, mx, my) {
  const defaultSize = 8;
  let deco;
  switch (type) {
    case 'circle':
      deco = { type: 'circle', cx: mx, cy: my, radius: defaultSize, mode: 'cut', rotation: 0 };
      break;
    case 'rect':
      deco = { type: 'rect', x: mx, y: my, width: defaultSize * 2, height: defaultSize, mode: 'cut', rotation: 0 };
      break;
    case 'star':
      deco = { type: 'star', cx: mx, cy: my, outerR: defaultSize, innerR: defaultSize * 0.4, points: 5, mode: 'cut', rotation: 0 };
      break;
    case 'text': {
      const text = prompt('输入文字:', 'Hello');
      if (!text) return;
      deco = { type: 'text', x: mx, y: my, content: text, fontSize: 10, mode: 'cut', rotation: 0 };
      break;
    }
    default: return;
  }
  decorations.push(deco);
  selectedIndex = decorations.length - 1;
}

function deleteSelected() {
  if (selectedIndex < 0) return;
  decorations.splice(selectedIndex, 1);
  selectedIndex = -1;
  draw();
}

// ── Properties panel sync ───────────────────────────────────────────────────

function updatePropsPanel() {
  const propsEl = document.getElementById('editorProps');
  if (selectedIndex < 0) {
    propsEl.style.opacity = '0.4';
    return;
  }
  propsEl.style.opacity = '1';
  const d = decorations[selectedIndex];

  document.getElementById('decoPosX').value = Math.round(d.cx !== undefined ? d.cx : d.x);
  document.getElementById('decoPosY').value = Math.round(d.cy !== undefined ? d.cy : d.y);
  document.getElementById('decoMode').value = d.mode || 'cut';
  document.getElementById('decoRotation').value = Math.round((d.rotation || 0) * 180 / Math.PI);

  const sizeEl = document.getElementById('decoSize');
  if (d.type === 'circle') sizeEl.value = Math.round(d.radius);
  else if (d.type === 'rect') sizeEl.value = Math.round(d.width);
  else if (d.type === 'star') sizeEl.value = Math.round(d.outerR);
  else if (d.type === 'text') sizeEl.value = Math.round(d.fontSize);
}

function syncPropsToDecoration() {
  if (selectedIndex < 0) return;
  const d = decorations[selectedIndex];
  const x = Number(document.getElementById('decoPosX').value);
  const y = Number(document.getElementById('decoPosY').value);
  const size = Number(document.getElementById('decoSize').value);
  const rot = Number(document.getElementById('decoRotation').value) * Math.PI / 180;
  const mode = document.getElementById('decoMode').value;

  if (d.cx !== undefined) { d.cx = x; d.cy = y; }
  else { d.x = x; d.y = y; }
  d.rotation = rot;
  d.mode = mode;

  if (d.type === 'circle') d.radius = size;
  else if (d.type === 'rect') { d.width = size; d.height = size * 0.5; }
  else if (d.type === 'star') { d.outerR = size; d.innerR = size * 0.4; }
  else if (d.type === 'text') d.fontSize = size;
}

function applyToModel() {
  if (currentFaceIndex < 0) return;
  setFaceDecoration(currentFaceIndex, JSON.parse(JSON.stringify(decorations)));
  closeFaceEditor();
}
