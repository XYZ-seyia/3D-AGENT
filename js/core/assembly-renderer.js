import * as THREE from 'three';
import { buildRectJointShape, buildPolygonJointShape, createPanelMesh } from './joint-kernel.js';

export function renderAssembly(assembly) {
  const group = new THREE.Group();

  for (const panel of assembly.panels) {
    if (panel.removed) continue;
    const mesh = renderPanel(panel);
    if (!mesh) continue;
    group.add(mesh);
  }

  group.traverse(child => {
    if (child.isMesh && child.userData.panelId) {
      child.userData.basePosition = child.position.clone();
    }
  });

  return group;
}

export function setExplodeFactor(group, factor, distance = 50) {
  group.traverse(child => {
    if (!child.isMesh || !child.userData.basePosition || !child.userData.explodeDir) return;
    const base = child.userData.basePosition;
    const dir = child.userData.explodeDir;
    child.position.set(
      base.x + dir.x * factor * distance,
      base.y + dir.y * factor * distance,
      base.z + dir.z * factor * distance,
    );
  });
}

function renderPanel(panel) {
  const holes = buildHolePaths(panel.holes);
  let shape;

  if (panel.shape?.type === 'polygon' && panel.shape.verts2D) {
    shape = buildPolygonJointShape({
      verts2D: panel.shape.verts2D,
      thickness: panel.thickness,
      edgeStyles: panel.edgeStyles,
      holes,
    });
  } else {
    const w = panel.shape?.width ?? 80;
    const h = panel.shape?.height ?? 60;
    shape = buildRectJointShape({
      width: w,
      height: h,
      thickness: panel.thickness,
      edges: panel.edgeStyles || { bottom: 'flat', right: 'flat', top: 'flat', left: 'flat' },
      holes,
    });
  }

  const mesh = createPanelMesh(shape, panel.thickness, panel.color ?? 0xaed581);

  if (panel.basis) {
    orientByBasis(mesh, panel.basis);
  } else {
    if (panel.rotation) mesh.rotation.set(...panel.rotation);
    if (panel.position) mesh.position.set(...panel.position);
  }

  mesh.userData = {
    panelId: panel.id,
    label: panel.label || panel.id,
    explodeDir: toVec3(panel.explodeDir || [0, 0, 0]),
    panelW: panel.shape?.width ?? 0,
    panelH: panel.shape?.height ?? 0,
    meta: panel.meta || {},
  };

  return mesh;
}

function orientByBasis(mesh, basis) {
  const localX = new THREE.Vector3(...basis.localX);
  const localY = new THREE.Vector3(...basis.localY);
  const normal = new THREE.Vector3(...basis.normal);
  const matrix = new THREE.Matrix4();
  matrix.makeBasis(localX, localY, normal);
  mesh.applyMatrix4(matrix);
  mesh.position.set(...basis.center);
}

function buildHolePaths(holes) {
  if (!holes || holes.length === 0) return [];
  return holes.map(d => {
    const path = new THREE.Path();
    if (d.type === 'circle') {
      path.absarc(d.cx, d.cy, d.radius, 0, Math.PI * 2, false);
    } else if (d.type === 'rect') {
      const hw = d.width / 2, hh = d.height / 2;
      path.moveTo(d.x - hw, d.y - hh);
      path.lineTo(d.x + hw, d.y - hh);
      path.lineTo(d.x + hw, d.y + hh);
      path.lineTo(d.x - hw, d.y + hh);
      path.closePath();
    } else if (d.type === 'polygon' && d.verts && d.verts.length >= 3) {
      path.moveTo(d.verts[0][0], d.verts[0][1]);
      for (let i = 1; i < d.verts.length; i++) {
        path.lineTo(d.verts[i][0], d.verts[i][1]);
      }
      path.closePath();
    }
    return path;
  });
}

function toVec3(arr) {
  if (arr instanceof THREE.Vector3) return arr;
  return new THREE.Vector3(...(arr || [0, 0, 0]));
}
