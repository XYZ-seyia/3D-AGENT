import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createModel } from '../core/schema.js';
import { updatePrimitiveParams, setOverride } from '../core/model-ops.js';
import { compileModelToAssembly } from '../core/macro-models.js';
import { renderAssembly, setExplodeFactor } from '../core/assembly-renderer.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. 数据模型层（js/core schema + model-ops）
// ═══════════════════════════════════════════════════════════════════════════

let model = createModel({
  primitives: [{
    id: 'box_1',
    primitive: 'box',
    params: { length: 100, width: 60, height: 40, thickness: 3 },
    joints: { type: 'finger' },
  }],
  meta: { name: '基础盒子', source: 'initial' },
});
model.primitives[0].joints = { type: 'finger' };
let lastChangeSource = null; // 'agent' | 'slider' | null

function setByPath(obj, path, value) {
  const parts = path.replace(/^\./, '').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const isIndex = /^\d+$/.test(nextKey);
    if (!(key in cur)) cur[key] = isIndex ? [] : {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function getByPath(obj, path) {
  let cur = obj;
  for (const key of path.replace(/^\./, '').split('.')) {
    cur = cur?.[key];
  }
  return cur;
}

function updateModel(path, value, source) {
  lastChangeSource = source || null;
  setByPath(model, path, value);
  onChange();
}

function onChange() {
  if (typeof window.onModelChange === 'function') window.onModelChange(model, lastChangeSource);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 渲染（js/core macro-models + assembly-renderer）
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 3. Mock Agent 解析器
// ═══════════════════════════════════════════════════════════════════════════

function parseNaturalLanguage(text) {
  const result = { length: 100, width: 60, height: 40, thickness: 3, jointType: 'finger' };
  const num = /(\d+(?:\.\d+)?)\s*(?:mm|厘米|cm)?/gi;
  const numbers = [];
  let match;
  while ((match = num.exec(text)) !== null) numbers.push(parseFloat(match[1]));

  if (text.includes('×') || text.includes('x') || text.includes('*')) {
    const parts = text.split(/[×x*]/).map(s => parseFloat(s.replace(/[^\d.]/g, ''))).filter(n => !isNaN(n) && n > 0);
    if (parts.length >= 3) {
      result.length = Math.min(300, Math.max(20, parts[0]));
      result.width = Math.min(300, Math.max(20, parts[1]));
      result.height = Math.min(200, Math.max(10, parts[2]));
    } else if (parts.length === 2) {
      result.length = Math.min(300, Math.max(20, parts[0]));
      result.width = Math.min(300, Math.max(20, parts[1]));
    }
  }
  if (numbers.length >= 1 && (text.includes('板厚') || text.includes('厚度'))) {
    const t = numbers[numbers.length - 1];
    if (t >= 1 && t <= 10) result.thickness = t;
  }
  if (numbers.length >= 3 && !text.includes('板厚') && !text.includes('厚度')) {
    const a = numbers[numbers.length - 3];
    const b = numbers[numbers.length - 2];
    const c = numbers[numbers.length - 1];
    if (a >= 20 && a <= 300 && b >= 20 && b <= 300 && c >= 10 && c <= 200) {
      result.length = a;
      result.width = b;
      result.height = c;
    }
  }
  if (/插榫|卡槽|tab/i.test(text)) result.jointType = 'tab';
  if (/指接|手指|finger/i.test(text)) result.jointType = 'finger';
  return result;
}

function replyFromParse(parsed) {
  const j = parsed.jointType === 'tab' ? '插榫' : '指接榫';
  return `已生成 ${parsed.length}×${parsed.width}×${parsed.height} mm 盒子，板厚 ${parsed.thickness} mm，${j}。`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 场景与 UI 绑定
// ═══════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x1a1a2e);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(120, 100, 160);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(60, 100, 80);
scene.add(dir);
scene.add(new THREE.GridHelper(400, 40, 0x333355, 0x222244));

let boxGroup = null;
let explodeFactor = 0;

function renderScene() {
  if (boxGroup) {
    scene.remove(boxGroup);
    boxGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material && !Array.isArray(c.material)) c.material.dispose();
    });
  }
  const assembly = compileModelToAssembly(model);
  boxGroup = renderAssembly(assembly);
  scene.add(boxGroup);
  setExplodeFactor(boxGroup, explodeFactor, 50);
}

function syncSlidersFromModel() {
  const p = model.primitives?.[0]?.params;
  if (!p) return;
  document.getElementById('paramLength').value = p.length;
  document.getElementById('paramWidth').value = p.width;
  document.getElementById('paramHeight').value = p.height;
  document.getElementById('paramThickness').value = p.thickness;
  document.getElementById('valLength').textContent = p.length;
  document.getElementById('valWidth').textContent = p.width;
  document.getElementById('valHeight').textContent = p.height;
  document.getElementById('valThickness').textContent = p.thickness;
  const joint = model.primitives?.[0]?.joints?.type || 'finger';
  document.getElementById('paramJoint').value = joint;
  document.getElementById('valJoint').textContent = joint === 'tab' ? '插榫' : '指接榫';
  const ov = model.overrides?.['box_1:front']?.position_offset;
  const oy = (ov && ov[1]) ?? 0;
  document.getElementById('overrideOffsetY').value = oy;
  document.getElementById('valOffsetY').textContent = oy;
}

function updateJSONViewer(source) {
  const pre = document.getElementById('jsonPre');
  const raw = JSON.stringify(model, null, 2);
  if (!pre.dataset.raw || pre.dataset.raw !== raw) {
    pre.dataset.raw = raw;
    let html = escapeHtml(raw)
      .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, (_, s) => ': <span class="str">"' + escapeHtml(s) + '"</span>')
      .replace(/: (\d+(?:\.\d+)?)/g, ': <span class="num">$1</span>');
    pre.innerHTML = html;
    if (source === 'agent') {
      pre.querySelectorAll('.key').forEach(el => { if (el.textContent === '"primitives"') el.classList.add('hl-prim'); });
    } else if (source === 'slider') {
      pre.querySelectorAll('.key').forEach(el => { if (el.textContent === '"overrides"') el.classList.add('hl-over'); });
    }
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

window.onModelChange = function(m, source) {
  renderScene();
  syncSlidersFromModel();
  updateJSONViewer(source);
};

document.getElementById('chatSend').addEventListener('click', () => {
  const input = document.getElementById('chatText');
  const text = (input.value || '').trim();
  if (!text) return;
  const chatLog = document.getElementById('chatLog');
  chatLog.innerHTML += '<div class="user">你：' + escapeHtml(text) + '</div>';
  const parsed = parseNaturalLanguage(text);
  updateModel('primitives.0.params.length', parsed.length, 'agent');
  updateModel('primitives.0.params.width', parsed.width, 'agent');
  updateModel('primitives.0.params.height', parsed.height, 'agent');
  updateModel('primitives.0.params.thickness', parsed.thickness, 'agent');
  updateModel('primitives.0.joints.type', parsed.jointType, 'agent');
  updateModel('meta.source', 'agent', 'agent');
  chatLog.innerHTML += '<div class="agent">Agent：' + escapeHtml(replyFromParse(parsed)) + '</div>';
  chatLog.scrollTop = chatLog.scrollHeight;
  input.value = '';
});

document.getElementById('chatText').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('chatSend').click();
});

document.getElementById('paramLength').addEventListener('input', e => {
  const v = Number(e.target.value);
  document.getElementById('valLength').textContent = v;
  updatePrimitiveParams(model, 'box_1', { length: v });
  lastChangeSource = 'slider';
  onChange();
});
document.getElementById('paramWidth').addEventListener('input', e => {
  const v = Number(e.target.value);
  document.getElementById('valWidth').textContent = v;
  updatePrimitiveParams(model, 'box_1', { width: v });
  lastChangeSource = 'slider';
  onChange();
});
document.getElementById('paramHeight').addEventListener('input', e => {
  const v = Number(e.target.value);
  document.getElementById('valHeight').textContent = v;
  updatePrimitiveParams(model, 'box_1', { height: v });
  lastChangeSource = 'slider';
  onChange();
});
document.getElementById('paramThickness').addEventListener('input', e => {
  const v = Number(e.target.value);
  document.getElementById('valThickness').textContent = v;
  updatePrimitiveParams(model, 'box_1', { thickness: v });
  lastChangeSource = 'slider';
  onChange();
});
document.getElementById('paramJoint').addEventListener('change', e => {
  const v = e.target.value;
  document.getElementById('valJoint').textContent = v === 'tab' ? '卡舌卡槽' : '指接榫';
  if (!model.primitives[0].joints) model.primitives[0].joints = {};
  model.primitives[0].joints.type = v;
  lastChangeSource = 'slider';
  onChange();
});

const BOX_PANEL_KEYS = ['front', 'back', 'left', 'right', 'top', 'bottom'];
document.getElementById('overrideOffsetY').addEventListener('input', e => {
  const v = Number(e.target.value);
  document.getElementById('valOffsetY').textContent = v;
  for (const key of BOX_PANEL_KEYS) {
    setOverride(model, `box_1:${key}`, { position_offset: [0, v, 0] });
  }
  lastChangeSource = 'slider';
  onChange();
});

document.getElementById('paramExplode').addEventListener('input', e => {
  explodeFactor = Number(e.target.value);
  document.getElementById('valExplode').textContent = explodeFactor.toFixed(2);
  if (boxGroup) setExplodeFactor(boxGroup, explodeFactor);
});

document.getElementById('jsonToggle').addEventListener('click', () => {
  const pre = document.getElementById('jsonPre');
  pre.style.display = pre.style.display === 'none' ? 'block' : 'none';
});

function onResize() {
  const canvas = document.getElementById('viewport');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

window.addEventListener('resize', onResize);
onResize();

renderScene();
syncSlidersFromModel();
updateJSONViewer(null);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
