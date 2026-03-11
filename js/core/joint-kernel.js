import * as THREE from 'three';
import {
  normalizeEdgeStyle,
  resolveJointDepth,
} from './joint-policies.js';
import { getJointType } from './joint-registry.js';

export function calcToothCount(edgeLength, thickness) {
  let count = Math.max(3, Math.floor(edgeLength / (3 * thickness)));
  if (count % 2 === 0) count += 1;
  return count;
}

export function buildRectJointShape({ width, height, thickness, edges, holes = [] }) {
  const points = [];
  points.push(...buildEdgePoints([0, 0], [width, 0], [0, -1], thickness, edges.bottom));
  points.push(...buildEdgePoints([width, 0], [width, height], [1, 0], thickness, edges.right));
  points.push(...buildEdgePoints([width, height], [0, height], [0, 1], thickness, edges.top));
  points.push(...buildEdgePoints([0, height], [0, 0], [-1, 0], thickness, edges.left));
  return buildShape(points, holes);
}

export function buildPolygonJointShape({ verts2D, thickness, edgeStyles, holes = [] }) {
  const points = [];
  for (let index = 0; index < verts2D.length; index++) {
    const start = verts2D[index];
    const end = verts2D[(index + 1) % verts2D.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy) || 1;
    const outward = [dy / length, -dx / length];
    points.push(...buildEdgePoints(start, end, outward, thickness, edgeStyles[index]));
  }
  return buildShape(points, holes);
}

export function createPanelMesh(shape, thickness, color) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

export function buildCrossSlotMetadata({ thickness, kerf = 0, depthFactor = 0.5 }) {
  return {
    slotWidth: thickness + kerf / 2,
    slotDepth: thickness * depthFactor,
    kerf,
  };
}

const GEOMETRY_FN_MAP = {
  'finger': buildFingerEdgePoints,
  'tab-slot': buildTabSlotEdgePoints,
  'cross-slot': buildCrossSlotEdgePoints,
  'tab-mortise': buildTabMortiseEdgePoints,
};

export function registerJointGeometry(jointKind, geometryFn) {
  GEOMETRY_FN_MAP[jointKind] = geometryFn;
}

function buildEdgePoints(start, end, outward, thickness, rawStyle) {
  const style = normalizeEdgeStyle(rawStyle);
  if (style.jointKind === 'flat' || style.edgeType === 'flat') {
    return [[start[0], start[1]]];
  }
  const def = getJointType(style.jointKind);
  const fn = GEOMETRY_FN_MAP[def?.geometryFn || style.jointKind];
  if (fn) {
    return fn(start, end, outward, thickness, style);
  }
  return buildFingerEdgePoints(start, end, outward, thickness, style);
}

function buildFingerEdgePoints(start, end, outward, thickness, style) {
  const edgeLength = distance2(start, end);
  const count = calcToothCount(edgeLength, thickness);
  const depth = resolveJointDepth({ thickness, kerf: style.kerf });
  const segmentWidth = edgeLength / count;
  const direction = normalize2([end[0] - start[0], end[1] - start[1]]);
  const points = [];

  for (let index = 0; index < count; index++) {
    const segmentStart = add2(start, scale2(direction, index * segmentWidth));
    const segmentEnd = add2(start, scale2(direction, (index + 1) * segmentWidth));
    const hasTab = style.edgeType === 'A' ? index % 2 === 0 : index % 2 !== 0;
    if (hasTab) {
      points.push(
        segmentStart,
        add2(segmentStart, scale2(outward, depth)),
        add2(segmentEnd, scale2(outward, depth)),
        segmentEnd
      );
    } else {
      points.push(segmentStart);
    }
  }

  return points.map(pair => [pair[0], pair[1]]);
}

function buildTabSlotEdgePoints(start, end, outward, thickness, style) {
  const edgeLength = distance2(start, end);
  if (edgeLength < 10) return [[start[0], start[1]]];

  const direction = normalize2([end[0] - start[0], end[1] - start[1]]);
  const depth = resolveJointDepth({ thickness, kerf: style.kerf });
  const tabWidth = Math.max(2 * thickness, 6);
  const tabCount = Math.max(2, Math.floor(edgeLength / 50));
  const totalTabSpace = tabCount * tabWidth;
  if (totalTabSpace > edgeLength) return [[start[0], start[1]]];
  const gap = (edgeLength - totalTabSpace) / (tabCount + 1);
  if (gap < 2) return [[start[0], start[1]]];

  const isTabSide = style.edgeType === 'A';
  const d = isTabSide ? depth : -depth;
  const points = [[start[0], start[1]]];

  for (let i = 0; i < tabCount; i++) {
    const tabStart = gap * (i + 1) + tabWidth * i;
    const tabEnd = tabStart + tabWidth;
    const pStart = add2(start, scale2(direction, tabStart));
    const pEnd = add2(start, scale2(direction, tabEnd));
    points.push(
      pStart,
      add2(pStart, scale2(outward, d)),
      add2(pEnd, scale2(outward, d)),
      pEnd
    );
  }

  return points.map(p => [p[0], p[1]]);
}

function buildTabMortiseEdgePoints(start, end, outward, thickness, style) {
  const edgeLength = distance2(start, end);
  if (edgeLength < 10) return [[start[0], start[1]]];

  const direction = normalize2([end[0] - start[0], end[1] - start[1]]);
  const tabWidth = style.params?.tabWidth ?? 10;
  const tabDepth = style.params?.tabDepth ?? thickness;

  let tabCount = style.params?.tabCount ?? 0;
  if (tabCount <= 0) {
    tabCount = Math.max(1, Math.floor(edgeLength / (tabWidth * 3)));
  }

  const totalTabSpace = tabCount * tabWidth;
  if (totalTabSpace > edgeLength) return [[start[0], start[1]]];
  const gap = (edgeLength - totalTabSpace) / (tabCount + 1);
  if (gap < 2) return [[start[0], start[1]]];

  const points = [[start[0], start[1]]];

  for (let i = 0; i < tabCount; i++) {
    const ts = gap * (i + 1) + tabWidth * i;
    const te = ts + tabWidth;
    const pTs = add2(start, scale2(direction, ts));
    const pTe = add2(start, scale2(direction, te));
    points.push(
      pTs,
      add2(pTs, scale2(outward, tabDepth)),
      add2(pTe, scale2(outward, tabDepth)),
      pTe
    );
  }

  return points.map(p => [p[0], p[1]]);
}

function buildCrossSlotEdgePoints(start, end, outward, thickness, style) {
  const edgeLength = distance2(start, end);
  const direction = normalize2([end[0] - start[0], end[1] - start[1]]);

  const slotWidth = (style.params?.slotWidth ?? thickness) + (style.kerf || 0);
  const depthRatio = style.params?.depthRatio ?? 0.5;
  const slotPosition = style.params?.slotPosition ?? 0.5;
  const slotDepth = style.params?.slotDepth ?? (edgeLength * depthRatio);

  const centerOffset = edgeLength * slotPosition;
  const halfWidth = slotWidth / 2;

  if (halfWidth >= centerOffset || centerOffset + halfWidth > edgeLength || slotDepth <= 0) {
    return [[start[0], start[1]]];
  }

  const inward = [-outward[0], -outward[1]];
  const pSlotLeft = add2(start, scale2(direction, centerOffset - halfWidth));
  const pSlotRight = add2(start, scale2(direction, centerOffset + halfWidth));
  const pInnerLeft = add2(pSlotLeft, scale2(inward, slotDepth));
  const pInnerRight = add2(pSlotRight, scale2(inward, slotDepth));

  return [
    [start[0], start[1]],
    pSlotLeft,
    pInnerLeft,
    pInnerRight,
    pSlotRight,
  ].map(p => [p[0], p[1]]);
}

function buildShape(rawPoints, holes = []) {
  const points = dedupeSequentialPoints(rawPoints);
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) {
    shape.lineTo(points[index][0], points[index][1]);
  }
  shape.closePath();
  for (const hole of holes) {
    shape.holes.push(hole);
  }
  return shape;
}

function dedupeSequentialPoints(rawPoints) {
  const result = [rawPoints[0]];
  for (let index = 1; index < rawPoints.length; index++) {
    const previous = result[result.length - 1];
    const current = rawPoints[index];
    if (Math.abs(previous[0] - current[0]) > 0.001 || Math.abs(previous[1] - current[1]) > 0.001) {
      result.push(current);
    }
  }
  return result;
}

function add2(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function scale2(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar];
}

function normalize2(vector) {
  const length = Math.hypot(vector[0], vector[1]) || 1;
  return [vector[0] / length, vector[1] / length];
}

function distance2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
