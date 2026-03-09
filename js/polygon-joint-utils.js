/**
 * Generate finger-jointed THREE.Shape for arbitrary regular polygons.
 * Reuses the same A/B complementary tab logic from joint-utils.js.
 */
import * as THREE from 'three';

function calcToothCount(edgeLen, thickness) {
  let n = Math.max(3, Math.floor(edgeLen / (3 * thickness)));
  if (n % 2 === 0) n += 1;
  return n;
}

/**
 * Generate points along a single edge with finger-joint tabs.
 * Works for edges of any direction.
 *
 * @param {number} x0,y0  start of edge
 * @param {number} x1,y1  end of edge
 * @param {number} outX,outY  unit outward normal
 * @param {number} t  material thickness (tab depth)
 * @param {string} type  'A' | 'B' | 'flat'
 * @returns {number[][]} array of [x,y] points
 */
function fingerEdgePts(x0, y0, x1, y1, outX, outY, t, type) {
  if (type === 'flat') return [[x0, y0]];

  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return [[x0, y0]];
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

function dedup(rawPts) {
  const pts = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.abs(rawPts[i][0] - prev[0]) > 1e-4 ||
        Math.abs(rawPts[i][1] - prev[1]) > 1e-4) {
      pts.push(rawPts[i]);
    }
  }
  return pts;
}

/**
 * Create a finger-jointed THREE.Shape for a polygon face.
 *
 * @param {number[][]} verts2D  polygon vertices in CCW order, e.g. [[x,y], ...]
 * @param {number} thickness   material thickness
 * @param {string[]} edgeTypes  array of 'A'|'B'|'flat' per edge
 * @param {THREE.Path[]} [holes]  optional holes (from decorations)
 * @returns {THREE.Shape}
 */
export function polygonJointShape(verts2D, thickness, edgeTypes, holes) {
  const allPts = [];
  const n = verts2D.length;

  for (let i = 0; i < n; i++) {
    const [x0, y0] = verts2D[i];
    const [x1, y1] = verts2D[(i + 1) % n];

    const edgeDx = x1 - x0;
    const edgeDy = y1 - y0;
    const len = Math.hypot(edgeDx, edgeDy);

    // Outward normal: rotate edge direction -90° (for CCW polygon, points outward)
    const outX = edgeDy / len;
    const outY = -edgeDx / len;

    allPts.push(...fingerEdgePts(x0, y0, x1, y1, outX, outY, thickness, edgeTypes[i]));
  }

  const pts = dedup(allPts);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], pts[i][1]);
  }
  shape.closePath();

  if (holes) {
    for (const h of holes) shape.holes.push(h);
  }

  return shape;
}

/**
 * Create a flat (no-joint) polygon shape for preview or reference.
 */
export function flatPolygonShape(verts2D) {
  const shape = new THREE.Shape();
  shape.moveTo(verts2D[0][0], verts2D[0][1]);
  for (let i = 1; i < verts2D.length; i++) {
    shape.lineTo(verts2D[i][0], verts2D[i][1]);
  }
  shape.closePath();
  return shape;
}
