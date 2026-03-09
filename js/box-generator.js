import * as THREE from 'three';
import { fingerJointShape, tabSlotShape, createPanelMesh } from './joint-utils.js';

const PANEL_COLORS = {
  front:  0xef9a9a,
  back:   0x90caf9,
  left:   0xa5d6a7,
  right:  0xffcc80,
  top:    0xce93d8,
  bottom: 0x80cbc4,
};

const PANEL_NAMES = {
  front:  '前面板',
  back:   '后面板',
  left:   '左面板',
  right:  '右面板',
  top:    '顶面板',
  bottom: '底面板',
};

/**
 * Parametric finger-joint box generator.
 *
 * Mental model (user's description):
 *   1. Start with a zero-thickness box of dimensions L × W × H
 *      centered at x=0, z=0, with y from 0 to H.
 *   2. Each face extrudes OUTWARD by material thickness T.
 *   3. At every shared edge, both panels grow tabs that extend
 *      outward from the panel. The tabs on adjacent panels are
 *      STAGGERED (complementary): where A has a tab, B does not.
 *
 * The zero-thickness box defines 6 face planes.
 * ExtrudeGeometry builds shapes in XY and extrudes along +Z.
 *
 * Panel sizes (all full-face, no reduction):
 *   Front / Back : L × H
 *   Left  / Right: W × H
 *   Top   / Bottom: L × W
 *
 * Edge type assignment (A and B are complementary):
 *   Front / Back : all edges type A
 *   Left  / Right: top & bottom edges A, left & right edges B
 *   Top   / Bottom: all edges type B
 */
export function generateBox(p) {
  const { length: L, width: W, height: H, thickness: T, jointType } = p;
  const shapeFn = jointType === 'finger' ? fingerJointShape : tabSlotShape;
  const group = new THREE.Group();

  const hL = L / 2;
  const hW = W / 2;

  // --- Front panel (L × H) ---
  // Face at z = -hW, extrude outward toward -Z.
  // Position so extrusion z ∈ [0,T] maps to world z ∈ [-hW-T, -hW].
  const front = makePanelMesh(shapeFn, L, H, T,
    { bottom: 'A', right: 'A', top: 'A', left: 'A' }, PANEL_COLORS.front);
  front.position.set(-hL, 0, -hW - T);
  front.userData = panelData(PANEL_NAMES.front, L, H, 0, 0, -1);

  // --- Back panel (L × H) ---
  // Face at z = +hW, extrude outward toward +Z.
  const back = makePanelMesh(shapeFn, L, H, T,
    { bottom: 'A', right: 'A', top: 'A', left: 'A' }, PANEL_COLORS.back);
  back.position.set(-hL, 0, hW);
  back.userData = panelData(PANEL_NAMES.back, L, H, 0, 0, 1);

  // --- Left panel (W × H) ---
  // Face at x = -hL, extrude outward toward -X.
  // rotation.y = π/2: local (x,y,z) → world (z, y, -x).
  // Shape width = W runs along world -Z after rotation.
  // Edges: bottom/top connect to Bottom/Top (type A),
  //        right/left connect to Front/Back (type B).
  const left = makePanelMesh(shapeFn, W, H, T,
    { bottom: 'A', right: 'B', top: 'A', left: 'B' }, PANEL_COLORS.left);
  left.rotation.y = Math.PI / 2;
  left.position.set(-hL - T, 0, hW);
  left.userData = panelData(PANEL_NAMES.left, W, H, -1, 0, 0);

  // --- Right panel (W × H) ---
  // Face at x = +hL, extrude outward toward +X.
  const right = makePanelMesh(shapeFn, W, H, T,
    { bottom: 'A', right: 'B', top: 'A', left: 'B' }, PANEL_COLORS.right);
  right.rotation.y = Math.PI / 2;
  right.position.set(hL, 0, hW);
  right.userData = panelData(PANEL_NAMES.right, W, H, 1, 0, 0);

  // --- Bottom panel (L × W) ---
  // Face at y = 0, extrude outward toward -Y.
  // rotation.x = -π/2: local (x,y,z) → world (x, z, -y).
  // All edges connect to Front/Back/Left/Right which use A → bottom uses B.
  const bottom = makePanelMesh(shapeFn, L, W, T,
    { bottom: 'B', right: 'B', top: 'B', left: 'B' }, PANEL_COLORS.bottom);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(-hL, -T, hW);
  bottom.userData = panelData(PANEL_NAMES.bottom, L, W, 0, -1, 0);

  // --- Top panel (L × W) ---
  // Face at y = H, extrude outward toward +Y.
  const top = makePanelMesh(shapeFn, L, W, T,
    { bottom: 'B', right: 'B', top: 'B', left: 'B' }, PANEL_COLORS.top);
  top.rotation.x = -Math.PI / 2;
  top.position.set(-hL, H, hW);
  top.userData = panelData(PANEL_NAMES.top, L, W, 0, 1, 0);

  group.add(front, back, left, right, bottom, top);

  group.traverse(child => {
    if (child.isMesh) {
      child.userData.basePosition = child.position.clone();
    }
  });

  return group;
}

function makePanelMesh(shapeFn, w, h, t, edges, color) {
  return createPanelMesh(shapeFn(w, h, t, edges), t, color);
}

function panelData(name, dimA, dimB, ex, ey, ez) {
  return {
    panelName: name,
    dimLabel: `${dimA} × ${dimB} mm`,
    explodeDir: new THREE.Vector3(ex, ey, ez),
  };
}

/**
 * Move panels along their explode direction for the exploded-view animation.
 */
export function setExplodeFactor(group, factor) {
  const distance = 40;
  group.traverse(child => {
    if (child.isMesh && child.userData.basePosition) {
      const b = child.userData.basePosition;
      const d = child.userData.explodeDir;
      child.position.set(
        b.x + d.x * factor * distance,
        b.y + d.y * factor * distance,
        b.z + d.z * factor * distance,
      );
    }
  });
}
