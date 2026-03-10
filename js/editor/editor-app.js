import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createModel, normalizeModel, getPrimitiveById, makeId } from '../core/schema.js';
import {
  addPrimitive,
  addRectPanel,
  addConnection,
  removePrimitive,
  movePrimitive,
  rotatePrimitive,
  updatePrimitiveParams,
  clearAutoConnections,
  detectAutoConnections,
  computeRectWorldEdges,
} from '../core/model-ops.js';
import { compileModelToAssembly } from '../core/macro-models.js';
import { renderAssembly } from '../core/assembly-renderer.js';
import { listMacroTemplates, createMacroTemplatePrimitive } from '../core/macro-registry.js';
import { analyzePublishCandidates, buildPublishedModelPreview } from '../core/publish-recognizers.js';
import { listJointTypes, getJointType } from '../core/joint-registry.js';

// ─────────────────────────────────────────────
//  Inlined engine (joint-kernel + joint-policies)
// ─────────────────────────────────────────────
function resolveJointDepth({thickness, kerf=0}) { return thickness + kerf/2; }

function normalizeEdgeStyle(s) {
  if (!s) return {jointKind:'flat',edgeType:'flat',kerf:0};
  if (typeof s === 'string') return s==='flat'?{jointKind:'flat',edgeType:'flat',kerf:0}:{jointKind:'finger',edgeType:s,kerf:0};
  return {jointKind:s.jointKind||'finger',edgeType:s.edgeType||'flat',kerf:+(s.kerf||0)};
}

function calcToothCount(len,t) { let n=Math.max(3,Math.floor(len/(3*t))); return n%2?n:n+1; }
function add2(a,b){return[a[0]+b[0],a[1]+b[1]];}
function sc2(v,s){return[v[0]*s,v[1]*s];}
function nm2(v){const l=Math.hypot(v[0],v[1])||1;return[v[0]/l,v[1]/l];}

function fingerPts(s,e,ow,t,style) {
  const len=Math.hypot(e[0]-s[0],e[1]-s[1]);
  const n=calcToothCount(len,t);
  const d=resolveJointDepth({thickness:t,kerf:style.kerf||0});
  const seg=len/n;
  const dir=nm2([e[0]-s[0],e[1]-s[1]]);
  const pts=[];
  for(let i=0;i<n;i++){
    const p0=add2(s,sc2(dir,i*seg)), p1=add2(s,sc2(dir,(i+1)*seg));
    const tab=style.edgeType==='A'?i%2===0:i%2!==0;
    if(tab) pts.push(p0,add2(p0,sc2(ow,d)),add2(p1,sc2(ow,d)),p1);
    else pts.push(p0);
  }
  return pts;
}

function edgePts(s,e,ow,t,raw) {
  const st=normalizeEdgeStyle(raw);
  if(st.jointKind==='flat'||st.edgeType==='flat') return[[s[0],s[1]]];
  return fingerPts(s,e,ow,t,st);
}

function buildRectShape({width:w,height:h,thickness:t,edges:E}) {
  const pts=[
    ...edgePts([0,0],[w,0],[0,-1],t,E.bottom),
    ...edgePts([w,0],[w,h],[1,0],t,E.right),
    ...edgePts([w,h],[0,h],[0,1],t,E.top),
    ...edgePts([0,h],[0,0],[-1,0],t,E.left),
  ];
  const d=[pts[0]];
  for(let i=1;i<pts.length;i++){
    const p=d[d.length-1],c=pts[i];
    if(Math.abs(p[0]-c[0])>.001||Math.abs(p[1]-c[1])>.001) d.push(c);
  }
  const sh=new THREE.Shape();
  sh.moveTo(d[0][0],d[0][1]);
  for(let i=1;i<d.length;i++) sh.lineTo(d[i][0],d[i][1]);
  sh.closePath();
  return sh;
}

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const SNAP_DIST    = 10;  // joint appears (edge-pair distance sum ≤ this)
const RELEASE_DIST = 22;  // joint disappears (hysteresis)
const PREVIEW_DIST = 32;  // approach glow

// Rotation presets: [rx,ry,rz] in radians
const ROT_PRESETS = [
  [0, 0, 0],                 // 0: vertical, face toward +Z
  [0, Math.PI/2, 0],         // 1: vertical, face toward +X  (side panel)
  [-Math.PI/2, 0, 0],        // 2: horizontal, face toward +Y (shelf/bottom)
];
const ROT_LABELS = ['竖·前','竖·侧','水平'];

// ─────────────────────────────────────────────
//  Model (canonical model from js/core)
// ─────────────────────────────────────────────
let model = createModel({ primitives: [], connections: [], meta: {} });
let selectedId = null;
let selectedPanelId = null;
let viewMode = 'macro';
let currentAssembly = { panels: [], connections: [] };
const compiledPanelIndex = new Map();
let publishState = {
  isOpen: false,
  analysis: null,
  selectedMode: 'freeAssembly',
  selectedCandidateId: null,
  retainedParams: {},
  previewModel: null,
};

const COLORS = [0x6366f1,0x10b981,0xf59e0b,0xef4444,0x8b5cf6,0x06b6d4,0xec4899,0x84cc16];

function nextSpawn() {
  const n = model.primitives.length;
  return n * 140;
}

function addPanel(cfg = {}) {
  const id = cfg.id || makeId('panel');
  const prim = addRectPanel(model, {
    id,
    label: cfg.label || `面板${model.primitives.length + 1}`,
    width: cfg.w ?? 120,
    height: cfg.h ?? 100,
    thickness: cfg.t ?? 6,
    pose: {
      position: cfg.pos ? [...cfg.pos] : [nextSpawn(), 0, 0],
      rotation: cfg.rot ? [...cfg.rot] : [...ROT_PRESETS[0]],
    },
    color: cfg.color ?? COLORS[model.primitives.length % COLORS.length],
  });
  return prim;
}

function getP(id) {
  return getPrimitiveById(model, id);
}

function getSelectedPrimitive() {
  return selectedId ? getPrimitiveById(model, selectedId) : null;
}

function getCompiledPanelInfo(panelId) {
  return compiledPanelIndex.get(panelId) || null;
}

function getSourcePrimitiveId(panelId) {
  return getCompiledPanelInfo(panelId)?.sourcePrimitiveId || panelId;
}

function getFirstRenderedPanelId(primitiveId) {
  for (const info of compiledPanelIndex.values()) {
    if (info.sourcePrimitiveId === primitiveId) return info.panelId;
  }
  return primitiveId;
}

function addMacroTemplate(templateId) {
  const primitive = createMacroTemplatePrimitive(templateId, {
    pose: { position: [nextSpawn(), 0, 0], rotation: [0, 0, 0] },
  });
  if (!primitive) return null;
  addPrimitive(model, primitive);
  return primitive;
}

function duplicatePrimitiveInstance(sourcePrimitive) {
  if (!sourcePrimitive) return null;
  if (sourcePrimitive.primitive === 'panel') {
    const np = addPanel({
      label: `${sourcePrimitive.label || '面板'}*`,
      w: sourcePrimitive.shape?.width,
      h: sourcePrimitive.shape?.height,
      t: sourcePrimitive.thickness,
      pos: [
        (sourcePrimitive.pose?.position?.[0] || 0) + 20,
        sourcePrimitive.pose?.position?.[1] || 0,
        (sourcePrimitive.pose?.position?.[2] || 0) + 20,
      ],
      rot: sourcePrimitive.pose?.rotation ? [...sourcePrimitive.pose.rotation] : [...ROT_PRESETS[0]],
      color: sourcePrimitive.style?.color,
    });
    if (sourcePrimitive.mirrored) np.mirrored = true;
    return np;
  }

  const duplicated = structuredClone(sourcePrimitive);
  duplicated.id = makeId(sourcePrimitive.primitive);
  duplicated.label = `${sourcePrimitive.label || sourcePrimitive.primitive}*`;
  duplicated.pose = duplicated.pose || { position: [0, 0, 0], rotation: [0, 0, 0] };
  duplicated.pose.position = [
    (duplicated.pose.position?.[0] || 0) + 20,
    duplicated.pose.position?.[1] || 0,
    (duplicated.pose.position?.[2] || 0) + 20,
  ];
  addPrimitive(model, duplicated);
  return duplicated;
}

// ─────────────────────────────────────────────
//  Three.js
// ─────────────────────────────────────────────
const canvas = document.getElementById('c3d');
const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor(0x07070f);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42,1,.1,8000);
camera.position.set(180, 220, 380);

const orbit = new OrbitControls(camera,canvas);
orbit.target.set(60,60,0);
orbit.enableDamping = true;
orbit.dampingFactor = .08;
orbit.update();

// Lights
scene.add(new THREE.AmbientLight(0xffffff,0.55));
const sun=new THREE.DirectionalLight(0xffffff,1.0); sun.position.set(300,500,300);
sun.castShadow=true; scene.add(sun);
const fill=new THREE.DirectionalLight(0x8090ff,0.35); fill.position.set(-200,-100,-200); scene.add(fill);

// Grid
let gridHelper = new THREE.GridHelper(700,35,0x1a1a2e,0x14142a);
gridHelper.position.y=-1; scene.add(gridHelper); let gridOn=true;

// Floor (receives shadow)
const floorGeo = new THREE.PlaneGeometry(700,700);
const floorMat = new THREE.ShadowMaterial({opacity:.18});
const floor = new THREE.Mesh(floorGeo,floorMat);
floor.rotation.x=-Math.PI/2; floor.position.y=-1; floor.receiveShadow=true;
scene.add(floor);

// Groups
const panelGroup = new THREE.Group(); scene.add(panelGroup);
const hlGroup = new THREE.Group(); scene.add(hlGroup);
let panelMeshes = []; // flat list for raycasting, refreshed in rebuildFromModel

let xray = false;

// ─────────────────────────────────────────────
//  Edge detection (3D) — uses model-ops for primitives
// ─────────────────────────────────────────────
function worldEdges(panel) {
  return computeRectWorldEdges(panel);
}

function scoreEdgePair(ea,eb) {
  // Face normals must be roughly perpendicular (joint makes sense for 90° assemblies)
  if(Math.abs(ea.normal.dot(eb.normal))>0.25) return Infinity;
  const d1=ea.start.distanceTo(eb.start)+ea.end.distanceTo(eb.end);
  const d2=ea.start.distanceTo(eb.end)+ea.end.distanceTo(eb.start);
  return Math.min(d1,d2);
}

// Returns { snapped:[], nearby:[] } from model.primitives (panel only)
function detectProximity() {
  const snapped = [], nearby = [];
  const panels = model.primitives.filter(p => p.primitive === 'panel' && p.shape?.type === 'rect');
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const pA = panels[i], pB = panels[j];
      const eA = worldEdges(pA), eB = worldEdges(pB);
      let best = Infinity, bA = null, bB = null;
      for (const ea of eA) for (const eb of eB) {
        const s = scoreEdgePair(ea, eb);
        if (s < best) { best = s; bA = ea; bB = eb; }
      }
      if (best <= SNAP_DIST) snapped.push({ panelA: pA.id, edgeA: bA.id, panelB: pB.id, edgeB: bB.id, score: best });
      else if (best <= PREVIEW_DIST) nearby.push({ panelA: pA.id, edgeA: bA.id, panelB: pB.id, edgeB: bB.id, score: best });
    }
  }
  return { snapped, nearby };
}

// ─────────────────────────────────────────────
//  Cross-slot detection — two panels intersecting through each other
// ─────────────────────────────────────────────
function detectCrossSlotPairs(edgeSnapped) {
  const skip = new Set(edgeSnapped.map(c => [c.panelA, c.panelB].sort().join(':')));
  const panels = model.primitives.filter(p => p.primitive === 'panel' && p.shape?.type === 'rect');
  const results = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (skip.has([panels[i].id, panels[j].id].sort().join(':'))) continue;
      const info = computeCrossSlot(panels[i], panels[j]);
      if (info) results.push(info);
    }
  }
  return results;
}

function computeCrossSlot(pA, pB) {
  const eA = worldEdges(pA), eB = worldEdges(pB);
  const nA = eA[0].normal, nB = eB[0].normal;

  if (Math.abs(nA.dot(nB)) > 0.3) return null;

  const oA = eA[0].start.clone();
  const xA = eA[0].end.clone().sub(oA);
  const yA = eA[3].start.clone().sub(oA);
  const wA = xA.length(), hA = yA.length();
  const xdA = xA.clone().normalize(), ydA = yA.clone().normalize();

  const oB = eB[0].start.clone();
  const xB = eB[0].end.clone().sub(oB);
  const yB = eB[3].start.clone().sub(oB);
  const wB = xB.length(), hB = yB.length();
  const xdB = xB.clone().normalize(), ydB = yB.clone().normalize();

  const thickA = pA.thickness ?? pA.material?.thickness ?? 3;
  const thickB = pB.thickness ?? pB.material?.thickness ?? 3;

  const cB = oB.clone().add(xB.clone().multiplyScalar(0.5)).add(yB.clone().multiplyScalar(0.5))
    .add(nB.clone().multiplyScalar(thickB / 2));
  const dBA = cB.clone().sub(oA);
  const bx = dBA.dot(xdA), by = dBA.dot(ydA);

  const cA = oA.clone().add(xA.clone().multiplyScalar(0.5)).add(yA.clone().multiplyScalar(0.5))
    .add(nA.clone().multiplyScalar(thickA / 2));
  const dAB = cA.clone().sub(oB);
  const ax = dAB.dot(xdB), ay = dAB.dot(ydB);

  const tol = 5;
  if (bx < -tol || bx > wA + tol || by < -tol || by > hA + tol) return null;
  if (ax < -tol || ax > wB + tol || ay < -tol || ay > hB + tol) return null;

  const distB = Math.abs(dBA.dot(nA));
  const extB = Math.abs(wB * xdB.dot(nA)) + Math.abs(hB * ydB.dot(nA));
  if (distB > extB * 0.5 + 5) return null;

  const distA = Math.abs(dAB.dot(nB));
  const extA = Math.abs(wA * xdA.dot(nB)) + Math.abs(hA * ydA.dot(nB));
  if (distA > extA * 0.5 + 5) return null;

  const interDir = new THREE.Vector3().crossVectors(nA, nB).normalize();
  const depthRatio = 0.5;
  const cl = v => Math.max(0, Math.min(1, v));

  const iAx = Math.abs(interDir.dot(xdA)), iAy = Math.abs(interDir.dot(ydA));
  let edgeA, posA, depthA;
  if (iAx >= iAy) {
    edgeA = 'right';
    posA = cl(by / hA);
    depthA = wA * depthRatio;
  } else {
    edgeA = 'top';
    posA = cl(1 - bx / wA);
    depthA = hA * depthRatio;
  }

  const iBx = Math.abs(interDir.dot(xdB)), iBy = Math.abs(interDir.dot(ydB));
  let edgeB, posB, depthB;
  if (iBx >= iBy) {
    edgeB = 'left';
    posB = cl(1 - ay / hB);
    depthB = wB * depthRatio;
  } else {
    edgeB = 'bottom';
    posB = cl(ax / wB);
    depthB = hB * depthRatio;
  }

  return {
    panelA: pA.id, edgeA,
    panelB: pB.id, edgeB,
    paramsA: { slotPosition: posA, slotDepth: depthA, slotWidth: thickB, depthRatio },
    paramsB: { slotPosition: posB, slotDepth: depthB, slotWidth: thickA, depthRatio },
  };
}

// ─────────────────────────────────────────────
//  Tab-mortise detection — panel edge touching another panel's face
// ─────────────────────────────────────────────
function detectTabMortisePairs(edgeSnapped, crossSlotPairs) {
  const skip = new Set([
    ...edgeSnapped.map(c => [c.panelA, c.panelB].sort().join(':')),
    ...crossSlotPairs.map(c => [c.panelA, c.panelB].sort().join(':')),
  ]);
  const panels = model.primitives.filter(p => p.primitive === 'panel' && p.shape?.type === 'rect');
  const results = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const key = [panels[i].id, panels[j].id].sort().join(':');
      if (skip.has(key)) continue;
      const ab = computeTabMortise(panels[i], panels[j]);
      if (ab) { results.push(ab); continue; }
      const ba = computeTabMortise(panels[j], panels[i]);
      if (ba) results.push(ba);
    }
  }
  return results;
}

function computeTabMortise(tabPanel, slotPanel) {
  const eTab = worldEdges(tabPanel), eSlot = worldEdges(slotPanel);
  const nTab = eTab[0].normal, nSlot = eSlot[0].normal;
  if (Math.abs(nTab.dot(nSlot)) > 0.3) return null;

  const oS = eSlot[0].start.clone();
  const xdS = eSlot[0].end.clone().sub(oS).normalize();
  const ydS = eSlot[3].start.clone().sub(oS).normalize();
  const wS = slotPanel.shape?.width ?? 80;
  const hS = slotPanel.shape?.height ?? 60;
  const thickS = slotPanel.thickness ?? slotPanel.material?.thickness ?? 3;
  const thickT = tabPanel.thickness ?? tabPanel.material?.thickness ?? 3;

  const FACE_DIST = 4;
  const EDGE_MARGIN = 5;
  const TAB_WIDTH = 10;

  for (const edge of eTab) {
    const ds = edge.start.clone().sub(oS);
    const de = edge.end.clone().sub(oS);
    const d1 = ds.dot(nSlot), d2 = de.dot(nSlot);

    const nearFront = Math.abs(d1) < FACE_DIST && Math.abs(d2) < FACE_DIST;
    const nearBack = Math.abs(d1 - thickS) < FACE_DIST && Math.abs(d2 - thickS) < FACE_DIST;
    if (!nearFront && !nearBack) continue;

    const p1x = ds.dot(xdS), p1y = ds.dot(ydS);
    const p2x = de.dot(xdS), p2y = de.dot(ydS);

    if (p1x < EDGE_MARGIN || p1x > wS - EDGE_MARGIN) continue;
    if (p2x < EDGE_MARGIN || p2x > wS - EDGE_MARGIN) continue;
    if (p1y < EDGE_MARGIN || p1y > hS - EDGE_MARGIN) continue;
    if (p2y < EDGE_MARGIN || p2y > hS - EDGE_MARGIN) continue;

    const edx = p2x - p1x, edy = p2y - p1y;
    const lineLen = Math.hypot(edx, edy);
    if (lineLen < TAB_WIDTH) continue;

    let tabCount = Math.max(1, Math.floor(lineLen / (TAB_WIDTH * 3)));
    const gap = (lineLen - tabCount * TAB_WIDTH) / (tabCount + 1);
    if (gap < 3) { tabCount = Math.max(1, tabCount - 1); }
    const finalGap = (lineLen - tabCount * TAB_WIDTH) / (tabCount + 1);
    if (finalGap < 2) continue;

    const ldx = edx / lineLen, ldy = edy / lineLen;
    const tolerance = 0.15;
    const slots = [];
    for (let ti = 0; ti < tabCount; ti++) {
      const t = finalGap * (ti + 1) + TAB_WIDTH * (ti + 0.5);
      const cx = p1x + ldx * t, cy = p1y + ldy * t;
      let slotW, slotH;
      if (Math.abs(ldx) > Math.abs(ldy)) {
        slotW = TAB_WIDTH + tolerance * 2;
        slotH = thickT + tolerance * 2;
      } else {
        slotW = thickT + tolerance * 2;
        slotH = TAB_WIDTH + tolerance * 2;
      }
      slots.push({ cx, cy, w: slotW, h: slotH });
    }

    return {
      panelA: tabPanel.id, edgeA: edge.id,
      panelB: slotPanel.id, edgeB: '_face_',
      paramsA: { tabWidth: TAB_WIDTH, tabDepth: thickS, tabCount },
      paramsB: { slots, tolerance },
    };
  }
  return null;
}

// Compute position to snap panel so that edge midpoints coincide
function snapPos(panel, snap) {
  const eA = worldEdges(panel);
  const pB = getP(snap.otherId);
  const eB = worldEdges(pB);
  const ea = eA.find(e => e.id === snap.myEdge);
  const eb = eB.find(e => e.id === snap.otherEdge);
  const pos = panel.pose?.position || [0, 0, 0];
  if (!ea || !eb) return pos;
  const mA = new THREE.Vector3().addVectors(ea.start, ea.end).multiplyScalar(0.5);
  const mB = new THREE.Vector3().addVectors(eb.start, eb.end).multiplyScalar(0.5);
  const d = new THREE.Vector3().subVectors(mB, mA);
  return [pos[0] + d.x, pos[1] + d.y, pos[2] + d.z];
}

// ─────────────────────────────────────────────
//  Rendering (js/core compile + renderAssembly)
// ─────────────────────────────────────────────
function rebuildFromModel() {
  panelGroup.clear();
  panelMeshes = [];
  compiledPanelIndex.clear();
  currentAssembly = compileModelToAssembly(model);
  for (const panel of currentAssembly.panels) {
    compiledPanelIndex.set(panel.id, {
      panelId: panel.id,
      label: panel.label || panel.id,
      panelKey: panel.meta?.panelKey || null,
      sourcePrimitiveId: panel.meta?.sourcePrimitive || panel.id,
      kind: panel.meta?.kind || 'panel',
    });
  }

  const group = renderAssembly(currentAssembly);
  group.traverse(c => {
    if (c.isMesh && c.userData.panelId) {
      panelMeshes.push(c);
      const panelId = c.userData.panelId;
      const sourcePrimitiveId = getSourcePrimitiveId(panelId);
      const sourcePrimitive = getPrimitiveById(model, sourcePrimitiveId);
      const isExpandedSel = panelId === selectedPanelId;
      const isMacroSel = sourcePrimitiveId === selectedId;
      const isSel = viewMode === 'expanded' ? isExpandedSel : isMacroSel;
      const isMacroSource = sourcePrimitive && sourcePrimitive.primitive !== 'panel';
      const macroColor = sourcePrimitive?.style?.color ?? 0x818cf8;
      const meshColor = c.material?.color?.getHex?.() ?? 0xaed581;
      const baseColor = xray
        ? 0x334155
        : (viewMode === 'macro' && isMacroSource ? macroColor : meshColor);
      if (c.material && !Array.isArray(c.material)) {
        c.material.color.setHex(isSel ? 0x818cf8 : baseColor);
        c.material.transparent = true;
        c.material.opacity = xray ? 0.35 : (isSel ? 0.95 : (viewMode === 'macro' && isMacroSource ? 0.8 : 0.88));
      }
    }
  });
  panelGroup.add(group);
}

// ─────────────────────────────────────────────
//  Highlights
// ─────────────────────────────────────────────
function drawEdgeLine(start, end, color, opacity=1) {
  const pts=[start.clone(),end.clone()];
  // Offset slightly toward camera
  const toC=new THREE.Vector3().subVectors(camera.position,start).normalize().multiplyScalar(2);
  pts[0].add(toC); pts[1].add(toC);
  const geo=new THREE.BufferGeometry().setFromPoints(pts);
  hlGroup.add(new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity})));
}

function updateHighlights(nearby, snapped) {
  hlGroup.clear();
  for (const c of nearby) {
    for (const [pid, eid] of [[c.panelA, c.edgeA], [c.panelB, c.edgeB]]) {
      const p = getP(pid); if (!p) continue;
      const e = worldEdges(p).find(x => x.id === eid); if (!e) continue;
      drawEdgeLine(e.start, e.end, 0xfbbf24, 0.6);
    }
  }
  for (const c of snapped) {
    for (const [pid, eid] of [[c.panelA, c.edgeA], [c.panelB, c.edgeB]]) {
      const p = getP(pid); if (!p) continue;
      const e = worldEdges(p).find(x => x.id === eid); if (!e) continue;
      drawEdgeLine(e.start, e.end, 0x06b6d4, 1);
    }
  }
}

// ─────────────────────────────────────────────
//  Connection update — sync model.connections from geometry proximity
// ─────────────────────────────────────────────
let prevHash = '';

function updateConnections(force = false) {
  const { snapped, nearby } = detectProximity();
  const crossSlots = detectCrossSlotPairs(snapped);
  const tabMortises = detectTabMortisePairs(snapped, crossSlots);

  const hashParts = snapped.map(c => `e:${c.panelA}:${c.edgeA}:${c.panelB}:${c.edgeB}`);
  crossSlots.forEach(c => hashParts.push(`x:${c.panelA}:${c.edgeA}:${c.panelB}:${c.edgeB}`));
  tabMortises.forEach(c => hashParts.push(`t:${c.panelA}:${c.edgeA}:${c.panelB}`));
  const hash = hashParts.sort().join('|');

  if (hash !== prevHash || force) {
    clearAutoConnections(model);
    for (const c of snapped) {
      addConnection(model, {
        panelA: c.panelA,
        edgeA: c.edgeA,
        panelB: c.panelB,
        edgeB: c.edgeB,
        joint: { kind: 'finger', kerf: 0, edgeTypes: ['A', 'B'] },
        meta: { source: 'system', auto: true, score: c.score },
      });
    }
    for (const c of crossSlots) {
      addConnection(model, {
        panelA: c.panelA,
        edgeA: c.edgeA,
        panelB: c.panelB,
        edgeB: c.edgeB,
        joint: {
          kind: 'cross-slot',
          kerf: 0,
          edgeTypes: ['A', 'B'],
          paramsA: c.paramsA,
          paramsB: c.paramsB,
        },
        meta: { source: 'system', auto: true },
      });
    }
    for (const c of tabMortises) {
      addConnection(model, {
        panelA: c.panelA,
        edgeA: c.edgeA,
        panelB: c.panelB,
        edgeB: c.edgeB,
        joint: {
          kind: 'tab-mortise',
          kerf: 0,
          edgeTypes: ['A', 'B'],
          paramsA: c.paramsA,
          paramsB: c.paramsB,
        },
        meta: { source: 'system', auto: true },
      });
    }
    prevHash = hash;
    rebuildFromModel();
    const fl = document.getElementById('jflash');
    if (fl) { fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); }
    updateConnList();
    updateRightPanel();
    updateJson();
  }

  updateHighlights(nearby, snapped);
  document.getElementById('snapbadge').classList.toggle('on', snapped.length > 0 && isDragging);
}

// ─────────────────────────────────────────────
//  Drag
// ─────────────────────────────────────────────
const ray = new THREE.Raycaster();
const mpos = new THREE.Vector2();
let isDragging=false, dragId=null;
const dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
const dragOffset=new THREE.Vector3();
let dragSnap=null;  // {otherId,myEdge,otherEdge}|null — current snap state
let rawDragPos=[0,0,0]; // unsnapped position during drag

function updateMouse(e) {
  const r=canvas.getBoundingClientRect();
  mpos.x=((e.clientX-r.left)/r.width)*2-1;
  mpos.y=-((e.clientY-r.top)/r.height)*2+1;
}

function hitPanel(e) {
  updateMouse(e);
  ray.setFromCamera(mpos, camera);
  const hits = ray.intersectObjects(panelMeshes);
  return hits.length ? hits[0].object.userData.panelId : null;
}

function planePt(e) {
  updateMouse(e);
  ray.setFromCamera(mpos,camera);
  const t=new THREE.Vector3();
  ray.ray.intersectPlane(dragPlane,t);
  return t;
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const panelId = hitPanel(e);
  if (!panelId) { deselect(); return; }
  const primitiveId = getSourcePrimitiveId(panelId);

  if (e.altKey) {
    const src = getP(primitiveId);
    const np = duplicatePrimitiveInstance(src);
    if (!np) return;
    selectedId = np.id;
    rebuildFromModel();
    selectedPanelId = getFirstRenderedPanelId(np.id);
    rebuildFromModel();
    updateConnList();
    updateRightPanel();
    startDrag(np.id, e);
    return;
  }

  e.stopPropagation();
  selectedId = primitiveId;
  selectedPanelId = panelId;
  rebuildFromModel();
  updateRightPanel();
  startDrag(primitiveId, e);
});

function startDrag(id, e) {
  orbit.enabled = false;
  isDragging = true;
  dragId = id;
  canvas.classList.add('drag');
  const p = getP(id);
  const pos = p?.pose?.position || [0, 0, 0];
  dragPlane.constant = -pos[1];
  const pt = planePt(e);
  if (pt) dragOffset.set(pos[0] - pt.x, 0, pos[2] - pt.z);
  rawDragPos = [...pos];
  dragSnap = null;
}

canvas.addEventListener('mousemove', e => {
  if (!isDragging || !dragId) {
    canvas.classList.toggle('hover', !!hitPanel(e));
    return;
  }
  const pt = planePt(e); if (!pt) return;
  const p = getP(dragId); if (!p) return;
  const py = (p.pose?.position || [0, 0, 0])[1];
  const rx = pt.x + dragOffset.x, rz = pt.z + dragOffset.z;
  rawDragPos = [rx, py, rz];

  if (dragSnap) {
    const sp = snapPos(p, dragSnap);
    const pull = Math.hypot(rx - sp[0], rz - sp[2]);
    if (pull > RELEASE_DIST) dragSnap = null;
  }

  let newPos;
  if (!dragSnap) {
    movePrimitive(model, dragId, [rx, py, rz]);
    const { snapped } = detectProximity();
    const mySnap = snapped.find(c => c.panelA === dragId || c.panelB === dragId);
    if (mySnap) {
      const isA = mySnap.panelA === dragId;
      dragSnap = { otherId: isA ? mySnap.panelB : mySnap.panelA, myEdge: isA ? mySnap.edgeA : mySnap.edgeB, otherEdge: isA ? mySnap.edgeB : mySnap.edgeA };
    }
    newPos = [rx, py, rz];
  } else {
    newPos = snapPos(p, dragSnap);
  }
  movePrimitive(model, dragId, newPos);
  rebuildFromModel();
  updateConnections();
});

canvas.addEventListener('mouseup',()=>{
  if(!isDragging) return;
  isDragging=false; orbit.enabled=true;
  canvas.classList.remove('drag');
  document.getElementById('snapbadge').classList.remove('on');
  dragId=null; dragSnap=null;
  updateConnections(true);
});

canvas.addEventListener('mouseleave',()=>{
  if(isDragging){isDragging=false;orbit.enabled=true;canvas.classList.remove('drag');dragId=null;dragSnap=null;}
});

// ─────────────────────────────────────────────
//  Keyboard
// ─────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(document.activeElement.tagName==='INPUT') return;
  if(e.key==='Delete'||e.key==='Backspace') { e.preventDefault(); delSelected(); }
  if(e.key==='Escape'){deselect();}
  if(e.key==='1') setRotPreset(0);
  if(e.key==='2') setRotPreset(1);
  if(e.key==='3') setRotPreset(2);
});

// ─────────────────────────────────────────────
//  UI actions
// ─────────────────────────────────────────────
function deselect() {
  selectedId = null;
  selectedPanelId = null;
  rebuildFromModel();
  updateRightPanel();
}

function addPreset(type) {
  const map = { plank: { w: 160, h: 80, t: 6 }, square: { w: 100, h: 100, t: 6 }, tall: { w: 80, h: 140, t: 6 }, wide: { w: 200, h: 60, t: 6 } };
  const cfg = map[type] || map.plank;
  const p = addPanel(cfg);
  selectedId = p.id;
  rebuildFromModel();
  selectedPanelId = getFirstRenderedPanelId(p.id);
  rebuildFromModel();
  updateConnList();
  updateRightPanel();
  updateJson();
}
window.addPreset = addPreset;

function insertMacroTemplate(templateId) {
  const primitive = addMacroTemplate(templateId);
  if (!primitive) return;
  selectedId = primitive.id;
  rebuildFromModel();
  selectedPanelId = getFirstRenderedPanelId(primitive.id);
  rebuildFromModel();
  updateConnList();
  updateRightPanel();
  updateJson();
}
window.insertMacroTemplate = insertMacroTemplate;

function loadScene(name) {
  clearAll();
  const scenes = {
    lshape: [
      { id: 'p1', w: 120, h: 100, t: 6, pos: [0, 0, 0], rot: [...ROT_PRESETS[0]], color: 0x6366f1, label: '竖板A' },
      { id: 'p2', w: 120, h: 100, t: 6, pos: [120, 0, 0], rot: [...ROT_PRESETS[1]], color: 0x10b981, label: '侧板B' },
    ],
    box3: [
      { id: 'p1', w: 140, h: 100, t: 6, pos: [-50, 0, 0], rot: [...ROT_PRESETS[0]], color: 0x6366f1, label: '前板' },
      { id: 'p2', w: 140, h: 100, t: 6, pos: [160, 0, 0], rot: [...ROT_PRESETS[0]], color: 0x8b5cf6, label: '后板' },
      { id: 'p3', w: 100, h: 140, t: 6, pos: [0, 0, -60], rot: [...ROT_PRESETS[2]], color: 0x10b981, label: '底板' },
    ],
    shelf: [
      { id: 'p1', w: 200, h: 120, t: 6, pos: [-30, 0, 0], rot: [...ROT_PRESETS[0]], color: 0xf59e0b, label: '侧板A' },
      { id: 'p2', w: 200, h: 120, t: 6, pos: [230, 0, 0], rot: [...ROT_PRESETS[0]], color: 0xf59e0b, label: '侧板B' },
      { id: 'p3', w: 100, h: 200, t: 6, pos: [100, 0, -50], rot: [...ROT_PRESETS[2]], color: 0xfbbf24, label: '搁板' },
    ],
    cross: [
      { id: 'p1', w: 160, h: 100, t: 6, pos: [-30, 0, -80], rot: [...ROT_PRESETS[0]], color: 0xef4444, label: '板A' },
      { id: 'p2', w: 160, h: 100, t: 6, pos: [-30, 0, 50], rot: [...ROT_PRESETS[0]], color: 0xf87171, label: '板B' },
      { id: 'p3', w: 160, h: 100, t: 6, pos: [-30, 0, -80], rot: [...ROT_PRESETS[1]], color: 0x06b6d4, label: '板C' },
      { id: 'p4', w: 160, h: 100, t: 6, pos: [100, 0, -80], rot: [...ROT_PRESETS[1]], color: 0x22d3ee, label: '板D' },
    ],
  };
  const list = scenes[name] || scenes.lshape;
  for (const cfg of list) {
    addRectPanel(model, {
      id: cfg.id,
      label: cfg.label,
      width: cfg.w,
      height: cfg.h,
      thickness: cfg.t,
      pose: { position: [...cfg.pos], rotation: [...cfg.rot] },
      color: cfg.color,
    });
  }
  updateConnections(true);
  updateJson();
}
window.loadScene = loadScene;

function delSelected() {
  if (!selectedId) return;
  const id = selectedId;
  selectedId = null;
  selectedPanelId = null;
  removePrimitive(model, id);
  prevHash = '';
  rebuildFromModel();
  updateConnections(true);
  updateRightPanel();
  updateJson();
}
window.delSelected = delSelected;

function clearAll() {
  model = createModel({ primitives: [], connections: [], meta: {} });
  selectedId = null;
  selectedPanelId = null;
  prevHash = '';
  rebuildFromModel();
  hlGroup.clear();
  updateConnList();
  updateRightPanel();
  updateJson();
}
window.clearAll = clearAll;

function setViewMode(mode) {
  viewMode = mode === 'expanded' ? 'expanded' : 'macro';
  if (viewMode === 'expanded' && selectedId) {
    selectedPanelId = getFirstRenderedPanelId(selectedId);
  }
  document.getElementById('btn-view-macro')?.classList.toggle('active', viewMode === 'macro');
  document.getElementById('btn-view-expanded')?.classList.toggle('active', viewMode === 'expanded');
  rebuildFromModel();
  updateRightPanel();
}
window.setViewMode = setViewMode;

function setRotPreset(idx) {
  if (!selectedId) return;
  const p = getP(selectedId);
  const rot = [...ROT_PRESETS[idx]];
  if (p && p.mirrored) rot[1] += Math.PI;
  rotatePrimitive(model, selectedId, rot);
  rebuildFromModel();
  selectedPanelId = getFirstRenderedPanelId(selectedId);
  rebuildFromModel();
  updateConnections(true);
  updateRightPanel();
  ['rp0', 'rp1', 'rp2'].forEach((id, i) => document.getElementById(id)?.classList.toggle('active', i === idx));
}
window.setRotPreset = setRotPreset;

function toggleMirror() {
  if (!selectedId) return;
  const p = getP(selectedId);
  if (!p || p.primitive !== 'panel') return;
  p.mirrored = !p.mirrored;
  const rot = p.pose?.rotation || [0, 0, 0];
  const delta = p.mirrored ? Math.PI : -Math.PI;
  rotatePrimitive(model, selectedId, [rot[0], rot[1] + delta, rot[2]]);
  rebuildFromModel();
  selectedPanelId = getFirstRenderedPanelId(selectedId);
  rebuildFromModel();
  updateConnections(true);
  updateRightPanel();
}
window.toggleMirror = toggleMirror;

function upSel(key, val) {
  if (!selectedId || isNaN(val) || val < 1) return;
  const p = getPrimitiveById(model, selectedId);
  if (!p) return;
  if (key === 'w') { p.shape = p.shape || {}; p.shape.width = val; }
  else if (key === 'h') { p.shape = p.shape || {}; p.shape.height = val; }
  else if (key === 't') updatePrimitiveParams(model, selectedId, { thickness: val });
  rebuildFromModel();
  updateConnections(true);
  updateJson();
}
window.upSel = upSel;

function upBoxParam(key, val) {
  if (!selectedId || isNaN(val) || val < 1) return;
  const primitive = getSelectedPrimitive();
  if (!primitive || primitive.primitive !== 'box') return;
  updatePrimitiveParams(model, selectedId, { [key]: val });
  rebuildFromModel();
  updateRightPanel();
  updateJson();
}
window.upBoxParam = upBoxParam;

function upBoxJoint(value) {
  const primitive = getSelectedPrimitive();
  if (!primitive || primitive.primitive !== 'box') return;
  primitive.joints = primitive.joints || {};
  primitive.joints.type = value;
  rebuildFromModel();
  updateRightPanel();
  updateJson();
}
window.upBoxJoint = upBoxJoint;

function upLampParam(key, val) {
  if (!selectedId || isNaN(val) || val < 1) return;
  const primitive = getSelectedPrimitive();
  if (!primitive || primitive.primitive !== 'lampshade') return;
  updatePrimitiveParams(model, selectedId, { [key]: val });
  rebuildFromModel();
  updateRightPanel();
  updateJson();
}
window.upLampParam = upLampParam;

function resetCam(){camera.position.set(180,220,380);orbit.target.set(60,60,0);orbit.update();}
window.resetCam = resetCam;

function toggleGrid(){
  gridOn=!gridOn; gridHelper.visible=gridOn;
  document.getElementById('btn-grid').classList.toggle('active',gridOn);
}
window.toggleGrid = toggleGrid;

function toggleXray() {
  xray = !xray;
  document.getElementById('btn-xray').classList.toggle('active', xray);
  rebuildFromModel();
}
window.toggleXray = toggleXray;

// ─────────────────────────────────────────────
//  UI Updates
// ─────────────────────────────────────────────
const ENAMES={left:'左',right:'右',top:'上',bottom:'下'};

function updateConnList() {
  const conns = currentAssembly.connections || [];
  document.getElementById('ccount').textContent = conns.length;
  document.getElementById('ccountleft').textContent = conns.length;
  const list = document.getElementById('clist');
  list.innerHTML = '';
  for (const c of conns) {
    const infoA = getCompiledPanelInfo(c.panelA);
    const infoB = getCompiledPanelInfo(c.panelB);
    const d = document.createElement('div');
    d.className = 'citem';
    const kind = c.joint?.kind || 'finger';
    d.innerHTML = `<div class="citem-head"><span class="clabel">指接卡槽</span><span class="jtag">${kind}</span></div>
<div class="cdetail">${infoA?.label || c.panelA}<span style="color:var(--cyan)">·${ENAMES[c.edgeA] || c.edgeA}</span><br>↕ ${infoB?.label || c.panelB}<span style="color:var(--cyan)">·${ENAMES[c.edgeB] || c.edgeB}</span></div>`;
    list.appendChild(d);
  }
}

function updateRightPanel() {
  const p = getSelectedPrimitive();
  const empty = document.getElementById('rempty');
  const panelFields = document.getElementById('panelFields');
  const boxFields = document.getElementById('boxFields');
  const lampshadeFields = document.getElementById('lampshadeFields');
  const propTitle = document.getElementById('propTitle');
  empty.style.display = p ? 'none' : '';
  panelFields.style.display = 'none';
  boxFields.style.display = 'none';
  if (lampshadeFields) lampshadeFields.style.display = 'none';
  propTitle.textContent = '对象属性';
  if (!p) return;

  if (p.primitive === 'lampshade') {
    propTitle.textContent = '灯罩组件';
    if (lampshadeFields) lampshadeFields.style.display = '';
    const params = p.params || {};
    document.getElementById('lsOuter').value = params.outerRadius ?? 80;
    document.getElementById('lsInner').value = params.innerRadius ?? 25;
    document.getElementById('lsHeight').value = params.height ?? 120;
    document.getElementById('lsRibs').value = params.ribCount ?? 8;
    document.getElementById('lsThick').value = params.thickness ?? 3;
    const faceInfo = selectedPanelId ? getCompiledPanelInfo(selectedPanelId) : null;
    const faceLabel = faceInfo && faceInfo.sourcePrimitiveId === p.id && faceInfo.panelKey ? `${faceInfo.label}（${faceInfo.panelKey}）` : '整个灯罩';
    document.getElementById('lampFaceHint').textContent =
      viewMode === 'expanded'
        ? `当前是展开视图，已选中：${faceLabel}。参数修改仍回写到同一个灯罩组件。`
        : '灯罩组件：上下圆环 + 径向肋片。';
  } else if (p.primitive === 'box') {
    propTitle.textContent = '盒子组件';
    boxFields.style.display = '';
    const params = p.params || {};
    document.getElementById('bl').value = params.length ?? 120;
    document.getElementById('bw').value = params.width ?? 80;
    document.getElementById('bh').value = params.height ?? 60;
    document.getElementById('bt').value = params.thickness ?? 3;
    document.getElementById('bjoint').value = p.joints?.type || 'finger';
    const faceInfo = selectedPanelId ? getCompiledPanelInfo(selectedPanelId) : null;
    const faceLabel = faceInfo && faceInfo.sourcePrimitiveId === p.id && faceInfo.panelKey ? `${faceInfo.label}（${faceInfo.panelKey}）` : '整个盒子';
    document.getElementById('boxFaceHint').textContent =
      viewMode === 'expanded'
        ? `当前是展开视图，已选中：${faceLabel}。参数修改仍回写到同一个 box 组件。`
        : '当前是组件视图，点击任一展开面都会选中整个盒子组件。';
  } else {
    propTitle.textContent = '面板属性';
    panelFields.style.display = '';
    const w = p.shape?.width ?? 80, h = p.shape?.height ?? 60, t = p.thickness ?? 6;
    document.getElementById('pw').value = w;
    document.getElementById('ph').value = h;
    document.getElementById('pt').value = t;
    const conns = currentAssembly.connections || [];
    const chips = document.getElementById('echips');
    chips.innerHTML = '';
    for (const [ek, el] of Object.entries(ENAMES)) {
      const on = conns.some(c => (c.panelA === p.id && c.edgeA === ek) || (c.panelB === p.id && c.edgeB === ek));
      const ch = document.createElement('span');
      ch.className = 'echip' + (on ? ' on' : '');
      ch.textContent = el + (on ? ' ⚡' : '');
      chips.appendChild(ch);
    }
  }

  const rot = p.pose?.rotation || [0, 0, 0];
  const isMirrored = p.mirrored || false;
  const baseRot = isMirrored ? [rot[0], rot[1] - Math.PI, rot[2]] : rot;
  const rotIdx = ROT_PRESETS.findIndex(r => r.every((v, i) => {
    let d = Math.abs(baseRot[i] - r[i]) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d < 0.01;
  }));
  ['rp0', 'rp1', 'rp2', 'btn-rot0', 'btn-rot1', 'btn-rot2'].forEach((id, index) => {
    const presetIndex = index % 3;
    document.getElementById(id)?.classList.toggle('active', presetIndex === rotIdx);
  });
  document.getElementById('mirrorBtn')?.classList.toggle('active', isMirrored);
}

function syntaxHL(json) {
  return json.replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,m=>{
    if(/^"/.test(m)) return /:$/.test(m)?`<span class="jk">${m}</span>`:`<span class="js">${m}</span>`;
    if(/true|false/.test(m)) return `<span class="jb">${m}</span>`;
    return `<span class="jn">${m}</span>`;
  });
}

function renderMacroTemplates() {
  const host = document.getElementById('macroTemplates');
  if (!host) return;
  host.innerHTML = '';
  for (const template of listMacroTemplates().filter(item => item.editorReady)) {
    const button = document.createElement('button');
    button.className = 'tpbtn';
    button.innerHTML = `<span>${template.icon}</span><span>${template.label}</span>`;
    button.title = template.description;
    button.addEventListener('click', () => insertMacroTemplate(template.id));
    host.appendChild(button);
  }
}

function renderJointOptions() {
  const select = document.getElementById('bjoint');
  if (!select) return;
  select.innerHTML = '';
  const joints = listJointTypes({ editorReady: true });
  for (const jt of joints) {
    if (jt.id === 'flat') continue;
    const opt = document.createElement('option');
    opt.value = jt.id === 'tab-slot' ? 'tab' : jt.id;
    opt.textContent = `${jt.icon} ${jt.label}`;
    opt.title = jt.description;
    select.appendChild(opt);
  }
}

function openPublishDialog() {
  const analysis = analyzePublishCandidates(model);
  const firstMacroCandidate = analysis.candidates.find(item => item.kind === 'macroCandidate') || null;
  publishState = {
    isOpen: true,
    analysis,
    selectedMode: firstMacroCandidate ? 'macro' : 'freeAssembly',
    selectedCandidateId: firstMacroCandidate?.id || null,
    retainedParams: Object.fromEntries((firstMacroCandidate?.retainedParams || []).map(key => [key, true])),
    previewModel: null,
  };
  refreshPublishPreview();
  document.getElementById('publishOverlay')?.classList.add('open');
}

function closePublishDialog() {
  publishState.isOpen = false;
  document.getElementById('publishOverlay')?.classList.remove('open');
}

function getActivePublishCandidate() {
  return publishState.analysis?.candidates?.find(item => item.id === publishState.selectedCandidateId) || null;
}

function refreshPublishPreview() {
  const candidate = getActivePublishCandidate();
  publishState.previewModel = buildPublishedModelPreview(model, {
    mode: publishState.selectedMode,
    candidate,
    retainedParams: publishState.retainedParams,
  });
  renderPublishDialog();
}

function renderPublishDialog() {
  if (!publishState.analysis) return;
  const { summary, candidates } = publishState.analysis;
  const macroCandidates = candidates.filter(item => item.kind === 'macroCandidate');
  const activeCandidate = getActivePublishCandidate();

  document.getElementById('publishSummary').innerHTML = [
    `primitive 数量：${summary.primitiveCount}`,
    `panel 数量：${summary.panelCount}`,
    `组件数量：${summary.macroCount}`,
    `connection 数量：${summary.connectionCount}`,
    `可选封装候选：${macroCandidates.length}`,
  ].join('<br>');

  const optionsHost = document.getElementById('publishOptions');
  optionsHost.innerHTML = '';
  if (macroCandidates.length > 0) {
    for (const candidate of macroCandidates) {
      const wrapper = document.createElement('label');
      wrapper.className = 'publish-option';
      wrapper.innerHTML = `<input type="radio" name="publishMode" value="${candidate.id}" ${publishState.selectedMode === 'macro' && publishState.selectedCandidateId === candidate.id ? 'checked' : ''}>
        封装为 ${candidate.primitiveType} 组件发布
        <div class="subnote">识别置信度：${candidate.confidence}。会把自由结构抽象为可参数化的组件。</div>`;
      wrapper.querySelector('input').addEventListener('change', () => {
        publishState.selectedMode = 'macro';
        publishState.selectedCandidateId = candidate.id;
        publishState.retainedParams = Object.fromEntries((candidate.retainedParams || []).map(key => [key, true]));
        refreshPublishPreview();
      });
      optionsHost.appendChild(wrapper);
    }
  }
  const freeOption = document.createElement('label');
  freeOption.className = 'publish-option';
  freeOption.innerHTML = `<input type="radio" name="publishMode" value="freeAssembly" ${publishState.selectedMode === 'freeAssembly' ? 'checked' : ''}>
    按自由结构发布
    <div class="subnote">保留当前 panel + connections，不做组件抽象。</div>`;
  freeOption.querySelector('input').addEventListener('change', () => {
    publishState.selectedMode = 'freeAssembly';
    refreshPublishPreview();
  });
  optionsHost.appendChild(freeOption);

  const candidateCard = document.getElementById('publishCandidateCard');
  const freeCard = document.getElementById('publishFreeCard');
  if (publishState.selectedMode === 'macro' && activeCandidate) {
    candidateCard.style.display = '';
    freeCard.style.display = 'none';
    document.getElementById('publishCandidateTitle').textContent = `建议封装为 ${activeCandidate.primitiveType} 组件`;
    document.getElementById('publishCandidateDesc').textContent =
      activeCandidate.source === 'existing-macro'
        ? '当前结构本身已经是组件，可直接按组件方式发布。'
        : '当前自由结构满足 box 识别规则，适合在发布时封装为组件。';
    renderPublishItems('publishReasons', activeCandidate.reasons);
    renderPublishChecks(activeCandidate);
    renderPublishItems('publishDroppedFields', activeCandidate.droppedFields.length > 0 ? activeCandidate.droppedFields : ['无明显结构信息丢失']);
  } else {
    candidateCard.style.display = 'none';
    freeCard.style.display = '';
  }

  const previewMeta = publishState.selectedMode === 'macro' && activeCandidate
    ? `当前预览：${activeCandidate.primitiveType} 组件发布`
    : '当前预览：自由结构发布';
  document.getElementById('publishPreviewMeta').textContent = previewMeta;
  document.getElementById('publishConfidence').textContent =
    publishState.selectedMode === 'macro' && activeCandidate ? `置信度 ${activeCandidate.confidence}` : '自由结构';
  document.getElementById('publishPreviewJson').innerHTML = syntaxHL(JSON.stringify(publishState.previewModel, null, 2));
}

function renderPublishItems(targetId, items) {
  const host = document.getElementById(targetId);
  host.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'publish-item';
    row.textContent = item;
    host.appendChild(row);
  }
}

function renderPublishChecks(candidate) {
  const host = document.getElementById('publishRetainedParams');
  host.innerHTML = '';
  for (const key of candidate.retainedParams || []) {
    const label = document.createElement('label');
    label.className = 'publish-check';
    const checked = publishState.retainedParams[key] !== false;
    label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}> ${publishParamLabel(key)}`;
    label.querySelector('input').addEventListener('change', e => {
      publishState.retainedParams[key] = e.target.checked;
      refreshPublishPreview();
    });
    host.appendChild(label);
  }
}

function publishParamLabel(key) {
  const map = {
    length: '长度',
    width: '宽度',
    height: '高度',
    thickness: '厚度',
    joint: '接合类型',
  };
  return map[key] || key;
}

async function copyPublishJson() {
  if (!publishState.previewModel) return;
  const raw = JSON.stringify(publishState.previewModel, null, 2);
  try {
    await navigator.clipboard.writeText(raw);
    document.getElementById('publishPreviewMeta').textContent = '已复制发布 JSON 到剪贴板';
  } catch {
    document.getElementById('publishPreviewMeta').textContent = '复制失败，请手动复制预览区内容';
  }
}

function updateJson() {
  document.getElementById('jbody').innerHTML = syntaxHL(JSON.stringify(normalizeModel(model), null, 2));
}

document.getElementById('btn-pub')?.addEventListener('click', openPublishDialog);
document.getElementById('btn-publish-close-top')?.addEventListener('click', closePublishDialog);
document.getElementById('btn-publish-close-bottom')?.addEventListener('click', closePublishDialog);
document.getElementById('btn-copy-publish-json')?.addEventListener('click', copyPublishJson);
document.getElementById('publishOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'publishOverlay') closePublishDialog();
});

// ─────────────────────────────────────────────
//  Resize + render loop
// ─────────────────────────────────────────────
function resize(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h,false);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}

function animate(){
  requestAnimationFrame(animate);
  resize();
  orbit.update();
  renderer.render(scene,camera);
}
animate();

// ─────────────────────────────────────────────
//  Init: L-shaped starter scene
// ─────────────────────────────────────────────
renderMacroTemplates();
renderJointOptions();
window.loadScene('lshape');
updateJson();

