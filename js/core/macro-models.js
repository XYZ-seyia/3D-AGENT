import * as THREE from 'three';
import { getScaledSolid } from '../poly-data.js';
import { getBoxEdgeStyles } from './joint-policies.js';

const BOX_COLORS = {
  front: 0xef9a9a,
  back: 0x90caf9,
  left: 0xa5d6a7,
  right: 0xffcc80,
  top: 0xce93d8,
  bottom: 0x80cbc4,
};

const POLY_COLORS = [
  0x4fc3f7, 0x81c784, 0xffb74d, 0xe57373, 0xba68c8,
  0x4dd0e1, 0xaed581, 0xfff176, 0xf06292, 0x7986cb,
  0xa1887f, 0x90a4ae,
];

export function compileModelToAssembly(model) {
  const assembly = { panels: [], connections: [] };

  for (const prim of model.primitives) {
    if (prim.primitive === 'box') {
      const compiled = compileBoxMacro(prim, model);
      assembly.panels.push(...compiled.panels);
      assembly.connections.push(...compiled.connections);
    } else if (prim.primitive === 'polyhedron') {
      const compiled = compilePolyhedronMacro(prim, model);
      assembly.panels.push(...compiled.panels);
      assembly.connections.push(...compiled.connections);
    } else if (prim.primitive === 'lampshade') {
      const compiled = compileLampshadeMacro(prim, model);
      assembly.panels.push(...compiled.panels);
      assembly.connections.push(...compiled.connections);
    } else if (prim.primitive === 'panel') {
      assembly.panels.push(compilePanelPrimitive(prim, model));
    }
  }

  assembly.connections.push(...(model.connections || []));
  applyConnectionsToPanels(assembly.panels, assembly.connections);
  applyOverrides(assembly.panels, model.overrides || {});
  return assembly;
}

export function compileBoxMacro(prim, model) {
  const { length = 100, width = 60, height = 40, thickness = 3 } = prim.params || {};
  const jointKind = prim.params?.jointKind || prim.joints?.type || 'finger';
  const hL = length / 2;
  const hW = width / 2;
  const prefix = prim.id;
  const pose = prim.pose || { position: [0, 0, 0], rotation: [0, 0, 0] };

  const specs = [
    { localId: 'front',  label: '前面板', w: length, h: height, color: BOX_COLORS.front,  pos: [-hL, 0, -hW - thickness], rot: [0, 0, 0],              explode: [0, 0, -1] },
    { localId: 'back',   label: '后面板', w: length, h: height, color: BOX_COLORS.back,   pos: [-hL, 0, hW],              rot: [0, 0, 0],              explode: [0, 0, 1]  },
    { localId: 'left',   label: '左面板', w: width,  h: height, color: BOX_COLORS.left,   pos: [-hL - thickness, 0, hW],  rot: [0, Math.PI / 2, 0],    explode: [-1, 0, 0] },
    { localId: 'right',  label: '右面板', w: width,  h: height, color: BOX_COLORS.right,  pos: [hL, 0, hW],               rot: [0, Math.PI / 2, 0],    explode: [1, 0, 0]  },
    { localId: 'bottom', label: '底面板', w: length, h: width,  color: BOX_COLORS.bottom, pos: [-hL, -thickness, hW],      rot: [-Math.PI / 2, 0, 0],   explode: [0, -1, 0] },
    { localId: 'top',    label: '顶面板', w: length, h: width,  color: BOX_COLORS.top,    pos: [-hL, height, hW],          rot: [-Math.PI / 2, 0, 0],   explode: [0, 1, 0]  },
  ];

  const panels = specs.map(s => {
    const posed = applyPoseToPanel({
      position: s.pos,
      rotation: s.rot,
    }, pose);
    return {
    id: `${prefix}:${s.localId}`,
    label: s.label,
    thickness,
    color: prim.style?.color ?? s.color,
    position: posed.position,
    rotation: posed.rotation,
    explodeDir: rotateVectorByPose(s.explode, pose),
    shape: { type: 'rect', width: s.w, height: s.h },
    edgeStyles: getBoxEdgeStyles(s.localId, jointKind),
    holes: collectHoles(model, `${prefix}:${s.localId}`) || collectHoles(model, s.localId),
    meta: { sourcePrimitive: prefix, panelKey: s.localId, kind: 'macro-panel' },
    };
  });

  return { panels, connections: buildBoxConnections(prefix, jointKind) };
}

export function compilePolyhedronMacro(prim, model) {
  const params = prim.params || {};
  const solidType = params.solidType || 'cube';
  const edgeLength = params.edgeLength ?? 60;
  const thickness = params.thickness ?? 3;
  const jointKind = params.jointKind || prim.joints?.type || 'finger';
  const solid = getScaledSolid(solidType, edgeLength);
  const pose = prim.pose || { position: [0, 0, 0], rotation: [0, 0, 0] };
  const panels = [];
  const connections = [];
  const sharedEdges = new Map();

  for (let fi = 0; fi < solid.faces.length; fi++) {
    const panelId = `${prim.id}:face_${fi}`;
    const edgeStyles = solid.edgeTypes[fi].map(et => ({
      jointKind,
      edgeType: et,
      kerf: 0,
    }));
    const posedBasis = applyPoseToBasis(solid.faceBases[fi], pose);
    panels.push({
      id: panelId,
      label: `面 ${fi}`,
      thickness,
      color: prim.style?.color ?? POLY_COLORS[fi % POLY_COLORS.length],
      basis: posedBasis,
      explodeDir: posedBasis.normal,
      shape: { type: 'polygon', verts2D: solid.faces2D[fi] },
      edgeStyles,
      holes: collectHoles(model, panelId),
      meta: { sourcePrimitive: prim.id, faceIndex: fi, kind: 'macro-panel', solidType },
    });

    const face = solid.faces[fi];
    for (let ei = 0; ei < face.length; ei++) {
      const a = face[ei], b = face[(ei + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!sharedEdges.has(key)) {
        sharedEdges.set(key, { panelId, edgeIndex: ei });
      } else {
        const match = sharedEdges.get(key);
        connections.push({
          id: `${prim.id}:edge_${key}`,
          panelA: match.panelId, edgeA: String(match.edgeIndex),
          panelB: panelId, edgeB: String(ei),
          joint: { kind: jointKind, kerf: 0, edgeTypes: ['A', 'B'] },
          meta: { source: 'macro', auto: false },
        });
      }
    }
  }

  return { panels, connections };
}

export function compileLampshadeMacro(prim, model) {
  const params = prim.params || {};
  const outerRadius = params.outerRadius ?? 80;
  const innerRadius = params.innerRadius ?? 25;
  const height = params.height ?? 120;
  const ribCount = params.ribCount ?? 12;
  const thickness = params.thickness ?? 3;
  const prefix = prim.id;
  const pose = prim.pose || { position: [0, 0, 0], rotation: [0, 0, 0] };

  const panels = [];
  const ringRadialWidth = outerRadius - innerRadius;
  const slotDepth = ringRadialWidth / 2;

  // --- Ring: outer boundary with cross-slot notches built into polygon ---
  const ringVerts = buildLampshadeRingPolygon(outerRadius, ribCount, thickness, slotDepth);
  const ringEdgeStyles = ringVerts.map(() => ({ jointKind: 'flat', edgeType: 'flat', kerf: 0 }));
  const ringHoles = [{ type: 'circle', cx: 0, cy: 0, radius: innerRadius }];

  // --- Rib: cross-slot edge style on bottom & top ---
  const flatEdge = { jointKind: 'flat', edgeType: 'flat', kerf: 0 };
  const crossSlotEdge = {
    jointKind: 'cross-slot',
    edgeType: 'A',
    kerf: 0,
    params: { depthRatio: 0.5, slotPosition: 0.5 },
  };

  // Top ring
  const topPosed = applyPoseToPanel({ position: [0, height, 0], rotation: [-Math.PI / 2, 0, 0] }, pose);
  panels.push({
    id: `${prefix}:ring_top`,
    label: '顶环',
    thickness,
    color: prim.style?.color ?? 0x4fc3f7,
    position: topPosed.position,
    rotation: topPosed.rotation,
    explodeDir: rotateVectorByPose([0, 1, 0], pose),
    shape: { type: 'polygon', verts2D: ringVerts },
    edgeStyles: ringEdgeStyles,
    holes: ringHoles,
    meta: { sourcePrimitive: prefix, panelKey: 'ring_top', kind: 'macro-panel' },
  });

  // Bottom ring
  const bottomPosed = applyPoseToPanel({ position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0] }, pose);
  panels.push({
    id: `${prefix}:ring_bottom`,
    label: '底环',
    thickness,
    color: prim.style?.color ?? 0x4fc3f7,
    position: bottomPosed.position,
    rotation: bottomPosed.rotation,
    explodeDir: rotateVectorByPose([0, -1, 0], pose),
    shape: { type: 'polygon', verts2D: ringVerts },
    edgeStyles: ringEdgeStyles,
    holes: ringHoles,
    meta: { sourcePrimitive: prefix, panelKey: 'ring_bottom', kind: 'macro-panel' },
  });

  // Ribs (vertical, radially arranged, cross-slot at top & bottom)
  const ribWidth = ringRadialWidth;
  const ribHeight = height;

  for (let i = 0; i < ribCount; i++) {
    const angle = (2 * Math.PI * i) / ribCount;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const ribLocal = {
      position: [
        innerRadius * cosA + (thickness / 2) * sinA,
        0,
        innerRadius * sinA - (thickness / 2) * cosA,
      ],
      rotation: [0, -angle, 0],
    };
    const ribPosed = applyPoseToPanel(ribLocal, pose);

    panels.push({
      id: `${prefix}:rib_${i}`,
      label: `肋片 ${i}`,
      thickness,
      color: prim.style?.color ?? 0xffb74d,
      position: ribPosed.position,
      rotation: ribPosed.rotation,
      explodeDir: rotateVectorByPose([cosA, 0, sinA], pose),
      shape: { type: 'rect', width: ribWidth, height: ribHeight },
      edgeStyles: {
        bottom: { ...crossSlotEdge },
        right: flatEdge,
        top: { ...crossSlotEdge },
        left: flatEdge,
      },
      holes: collectHoles(model, `${prefix}:rib_${i}`),
      meta: { sourcePrimitive: prefix, panelKey: `rib_${i}`, kind: 'macro-panel' },
    });
  }

  return { panels, connections: [] };
}

// Build ring outer polygon with radial slot notches at each rib position.
// The boundary is a circle with rectangular indentations from the outer edge.
function buildLampshadeRingPolygon(outerR, ribCount, thickness, slotDepth) {
  const verts = [];
  const halfW = (thickness + 0.3) / 2;
  const arcPoints = Math.max(3, Math.ceil(36 / ribCount));
  const slotAngularOffset = Math.atan2(halfW, outerR);
  const innerR = outerR - slotDepth;

  for (let i = 0; i < ribCount; i++) {
    const angle = (2 * Math.PI * i) / ribCount;
    const nextAngle = (2 * Math.PI * (i + 1)) / ribCount;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // 4 slot-notch vertices (CCW: CW-outer → CW-inner → CCW-inner → CCW-outer)
    verts.push([outerR * cosA + halfW * sinA, outerR * sinA - halfW * cosA]);
    verts.push([innerR * cosA + halfW * sinA, innerR * sinA - halfW * cosA]);
    verts.push([innerR * cosA - halfW * sinA, innerR * sinA + halfW * cosA]);
    verts.push([outerR * cosA - halfW * sinA, outerR * sinA + halfW * cosA]);

    // Smooth arc between this slot and the next
    const arcStart = angle + slotAngularOffset;
    const arcEnd = nextAngle - slotAngularOffset;
    if (arcEnd > arcStart) {
      for (let j = 1; j <= arcPoints; j++) {
        const t = j / (arcPoints + 1);
        const a = arcStart + t * (arcEnd - arcStart);
        verts.push([outerR * Math.cos(a), outerR * Math.sin(a)]);
      }
    }
  }

  return verts;
}

export function compilePanelPrimitive(prim, model) {
  const pose = prim.pose || { position: [0, 0, 0], rotation: [0, 0, 0] };
  const shape = prim.shape || { type: 'rect', width: 80, height: 60 };
  const flatEdge = { jointKind: 'flat', edgeType: 'flat', kerf: 0 };
  const defaultEdges = { bottom: flatEdge, right: flatEdge, top: flatEdge, left: flatEdge };

  return {
    id: prim.id,
    label: prim.label || prim.id,
    thickness: prim.thickness ?? prim.material?.thickness ?? 3,
    color: prim.style?.color ?? 0xaed581,
    position: pose.position || [0, 0, 0],
    rotation: pose.rotation || [0, 0, 0],
    shape,
    edgeStyles: defaultEdges,
    holes: collectHoles(model, prim.id),
    explodeDir: [0, 0, 0],
    meta: { sourcePrimitive: prim.id, kind: 'panel' },
  };
}

function applyConnectionsToPanels(panels, connections) {
  const map = new Map(panels.map(p => [p.id, p]));
  for (const conn of connections) {
    const pA = map.get(conn.panelA);
    const pB = map.get(conn.panelB);
    if (!pA || !pB) continue;
    const kind = conn.joint?.kind || 'finger';
    const kerf = conn.joint?.kerf ?? 0;
    const [typeA, typeB] = conn.joint?.edgeTypes || ['A', 'B'];
    const styleA = { jointKind: kind, edgeType: typeA, kerf, params: conn.joint?.paramsA || {} };
    const styleB = { jointKind: kind, edgeType: typeB, kerf, params: conn.joint?.paramsB || {} };
    if (pA.edgeStyles && typeof pA.edgeStyles === 'object' && !Array.isArray(pA.edgeStyles)) {
      if (conn.edgeA in pA.edgeStyles) pA.edgeStyles[conn.edgeA] = styleA;
    }
    if (pB.edgeStyles && typeof pB.edgeStyles === 'object' && !Array.isArray(pB.edgeStyles)) {
      if (conn.edgeB in pB.edgeStyles) pB.edgeStyles[conn.edgeB] = styleB;
    }

    if (kind === 'tab-mortise' && conn.joint?.paramsB?.slots) {
      if (!pB.holes) pB.holes = [];
      for (const slot of conn.joint.paramsB.slots) {
        pB.holes.push({ type: 'rect', x: slot.cx, y: slot.cy, width: slot.w, height: slot.h });
      }
    }
  }
}

function applyOverrides(panels, overrides) {
  for (const panel of panels) {
    const ov = overrides[panel.id] || overrides[panel.meta?.panelKey];
    if (!ov) continue;
    if (ov.removed) panel.removed = true;
    if (ov.position_offset) {
      panel.position = [
        (panel.position[0] || 0) + ov.position_offset[0],
        (panel.position[1] || 0) + ov.position_offset[1],
        (panel.position[2] || 0) + ov.position_offset[2],
      ];
    }
    if (ov.locked) panel.locked = true;
  }
}

function collectHoles(model, panelId) {
  const decos = model.decorations?.[panelId];
  if (!decos || decos.length === 0) return null;
  return decos.filter(d => d.mode === 'cut');
}

function buildBoxConnections(prefix, jointKind) {
  const pairs = [
    ['front', 'bottom', 'left',  'bottom', ['A', 'B']],
    ['front', 'right', 'right',  'left',   ['A', 'B']],
    ['front', 'top',   'top',    'bottom',  ['A', 'B']],
    ['front', 'left',  'left',   'right',   ['A', 'B']],
    ['back',  'bottom', 'bottom','top',     ['A', 'B']],
    ['back',  'right', 'right',  'right',   ['A', 'B']],
    ['back',  'top',   'top',    'top',     ['A', 'B']],
    ['back',  'left',  'left',   'left',    ['A', 'B']],
    ['left',  'bottom', 'bottom','left',    ['A', 'B']],
    ['left',  'top',   'top',    'left',    ['A', 'B']],
    ['right', 'bottom', 'bottom','right',   ['A', 'B']],
    ['right', 'top',   'top',    'right',   ['A', 'B']],
  ];
  return pairs.map(([pA, eA, pB, eB, types]) => ({
    id: `${prefix}:conn_${pA}_${eA}_${pB}_${eB}`,
    panelA: `${prefix}:${pA}`, edgeA: eA,
    panelB: `${prefix}:${pB}`, edgeB: eB,
    joint: { kind: jointKind, kerf: 0, edgeTypes: types },
    meta: { source: 'macro', auto: false },
  }));
}

function applyPoseToPanel(panel, pose) {
  const parentQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(pose.rotation || [0, 0, 0]), 'XYZ'));
  const localQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(panel.rotation || [0, 0, 0]), 'XYZ'));
  const worldQuat = parentQuat.clone().multiply(localQuat);
  const worldEuler = new THREE.Euler().setFromQuaternion(worldQuat, 'XYZ');
  const localPosition = new THREE.Vector3(...(panel.position || [0, 0, 0])).applyQuaternion(parentQuat);
  const basePosition = pose.position || [0, 0, 0];

  return {
    position: [
      localPosition.x + basePosition[0],
      localPosition.y + basePosition[1],
      localPosition.z + basePosition[2],
    ],
    rotation: [worldEuler.x, worldEuler.y, worldEuler.z],
  };
}

function applyPoseToBasis(basis, pose) {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(pose.rotation || [0, 0, 0]), 'XYZ'));
  const center = new THREE.Vector3(...basis.center).applyQuaternion(quat);
  const position = pose.position || [0, 0, 0];

  return {
    ...basis,
    center: [center.x + position[0], center.y + position[1], center.z + position[2]],
    localX: new THREE.Vector3(...basis.localX).applyQuaternion(quat).toArray(),
    localY: new THREE.Vector3(...basis.localY).applyQuaternion(quat).toArray(),
    normal: new THREE.Vector3(...basis.normal).applyQuaternion(quat).toArray(),
  };
}

function rotateVectorByPose(vector, pose) {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(pose.rotation || [0, 0, 0]), 'XYZ'));
  return new THREE.Vector3(...vector).applyQuaternion(quat).toArray();
}
