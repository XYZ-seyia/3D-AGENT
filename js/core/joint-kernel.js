import * as THREE from 'three';
import {
  normalizeEdgeStyle,
  resolveJointDepth,
} from './joint-policies.js';

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

function buildEdgePoints(start, end, outward, thickness, rawStyle) {
  const style = normalizeEdgeStyle(rawStyle);
  if (style.jointKind === 'flat' || style.edgeType === 'flat') {
    return [[start[0], start[1]]];
  }
  if (style.jointKind === 'tab-slot') {
    return buildTabSlotEdgePoints(start, end, outward, thickness, style);
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
  const tabCount = Math.max(2, Math.floor(edgeLength / 30));
  const divisions = 2 * tabCount + 1;
  const depth = resolveJointDepth({ thickness, kerf: style.kerf });
  const segmentWidth = edgeLength / divisions;
  const direction = normalize2([end[0] - start[0], end[1] - start[1]]);
  const points = [];

  for (let index = 0; index < divisions; index++) {
    const segmentStart = add2(start, scale2(direction, index * segmentWidth));
    const segmentEnd = add2(start, scale2(direction, (index + 1) * segmentWidth));
    const hasTab = style.edgeType === 'A' ? index % 2 === 1 : index % 2 === 0;
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
