import * as THREE from 'three';

function calcToothCount(edgeLen, thickness) {
  let n = Math.max(3, Math.floor(edgeLen / (3 * thickness)));
  if (n % 2 === 0) n += 1;
  return n;
}

/**
 * Generate a panel shape with finger-joint edges.
 *
 * Edge types:
 *   'A' — tabs at even-indexed segments (0, 2, 4, …)
 *   'B' — tabs at odd-indexed segments  (1, 3, 5, …)
 *   'flat' — straight edge, no joints
 *
 * Both A and B extend OUTWARD from the panel edge by thickness t.
 * Adjacent panels use complementary types (A↔B) so their tabs interleave.
 *
 * @param {number} w  - panel width  (x-axis in shape coords)
 * @param {number} h  - panel height (y-axis in shape coords)
 * @param {number} t  - material thickness
 * @param {{ bottom: string, right: string, top: string, left: string }} edges
 */
export function fingerJointShape(w, h, t, edges) {
  const pts = [];
  // Walk CCW: bottom → right → top → left
  // outX/outY = outward normal pointing AWAY from panel center
  pts.push(...fingerEdgePts(0, 0, w, 0, 0, -1, t, edges.bottom));
  pts.push(...fingerEdgePts(w, 0, w, h, 1, 0, t, edges.right));
  pts.push(...fingerEdgePts(w, h, 0, h, 0, 1, t, edges.top));
  pts.push(...fingerEdgePts(0, h, 0, 0, -1, 0, t, edges.left));
  return buildShape(pts);
}

function fingerEdgePts(x0, y0, x1, y1, outX, outY, t, type) {
  if (type === 'flat') return [[x0, y0]];

  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = calcToothCount(len, t);
  const segW = len / n;
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const pts = [];

  for (let i = 0; i < n; i++) {
    const sx = x0 + dx * i * segW;
    const sy = y0 + dy * i * segW;
    const ex = x0 + dx * (i + 1) * segW;
    const ey = y0 + dy * (i + 1) * segW;

    const isEven = i % 2 === 0;
    const hasTab = type === 'A' ? isEven : !isEven;

    if (hasTab) {
      pts.push([sx, sy]);
      pts.push([sx + outX * t, sy + outY * t]);
      pts.push([ex + outX * t, ey + outY * t]);
      pts.push([ex, ey]);
    } else {
      pts.push([sx, sy]);
    }
  }
  return pts;
}

/**
 * Generate a panel shape with tab-and-slot edges (same A/B complementary system).
 */
export function tabSlotShape(w, h, t, edges) {
  const pts = [];
  pts.push(...tabSlotEdgePts(0, 0, w, 0, 0, -1, t, edges.bottom));
  pts.push(...tabSlotEdgePts(w, 0, w, h, 1, 0, t, edges.right));
  pts.push(...tabSlotEdgePts(w, h, 0, h, 0, 1, t, edges.top));
  pts.push(...tabSlotEdgePts(0, h, 0, 0, -1, 0, t, edges.left));
  return buildShape(pts);
}

function tabSlotEdgePts(x0, y0, x1, y1, outX, outY, t, type) {
  if (type === 'flat') return [[x0, y0]];

  const len = Math.hypot(x1 - x0, y1 - y0);
  const M = Math.max(2, Math.floor(len / 30));
  const divisions = 2 * M + 1;
  const segW = len / divisions;
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const pts = [];

  for (let i = 0; i < divisions; i++) {
    const sx = x0 + dx * i * segW;
    const sy = y0 + dy * i * segW;
    const ex = x0 + dx * (i + 1) * segW;
    const ey = y0 + dy * (i + 1) * segW;

    const isOdd = i % 2 === 1;
    const hasTab = type === 'A' ? isOdd : !isOdd;

    if (hasTab) {
      pts.push([sx, sy]);
      pts.push([sx + outX * t, sy + outY * t]);
      pts.push([ex + outX * t, ey + outY * t]);
      pts.push([ex, ey]);
    } else {
      pts.push([sx, sy]);
    }
  }
  return pts;
}

function buildShape(rawPts) {
  const pts = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.abs(rawPts[i][0] - prev[0]) > 0.001 ||
        Math.abs(rawPts[i][1] - prev[1]) > 0.001) {
      pts.push(rawPts[i]);
    }
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], pts[i][1]);
  }
  shape.closePath();
  return shape;
}

export function createPanelMesh(shape, thickness, color) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}
