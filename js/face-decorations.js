/**
 * Apply face decorations to 3D panels.
 * - 'cut' mode: returns THREE.Path[] to be added as shape holes
 * - 'engrave' mode: returns THREE.Mesh[] to overlay on the panel surface
 */
import * as THREE from 'three';

/**
 * Process decorations and return either holes (for cut) or meshes (for engrave).
 *
 * @param {Object[]} decorations  array of decoration objects
 * @param {string} mode  'cut' or 'engrave'
 * @returns {THREE.Path[]|THREE.Mesh[]|null}
 */
export function applyDecorations(decorations, mode) {
  if (!decorations || decorations.length === 0) return null;

  const cutItems = decorations.filter(d => d.mode === 'cut');
  const engraveItems = decorations.filter(d => d.mode === 'engrave');

  if (mode === 'cut') {
    if (cutItems.length === 0) return null;
    return cutItems.map(d => decorationToPath(d));
  }

  if (mode === 'engrave') {
    if (engraveItems.length === 0) return null;
    return engraveItems.map(d => decorationToEngraveMesh(d));
  }

  return null;
}

function decorationToPath(deco) {
  const path = new THREE.Path();

  switch (deco.type) {
    case 'circle': {
      const { cx, cy, radius } = deco;
      path.absarc(cx, cy, radius, 0, Math.PI * 2, false);
      break;
    }
    case 'rect': {
      const { x, y, width, height, rotation = 0 } = deco;
      const hw = width / 2;
      const hh = height / 2;
      let corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      if (rotation !== 0) {
        corners = corners.map(c => rotatePoint(c[0], c[1], rotation));
      }
      corners = corners.map(c => [c[0] + x, c[1] + y]);
      path.moveTo(corners[0][0], corners[0][1]);
      for (let i = 1; i < corners.length; i++) {
        path.lineTo(corners[i][0], corners[i][1]);
      }
      path.closePath();
      break;
    }
    case 'star': {
      const { cx, cy, outerR, innerR, points = 5, rotation = 0 } = deco;
      const step = Math.PI / points;
      path.moveTo(
        cx + outerR * Math.cos(rotation - Math.PI / 2),
        cy + outerR * Math.sin(rotation - Math.PI / 2),
      );
      for (let i = 1; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = rotation - Math.PI / 2 + i * step;
        path.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
      }
      path.closePath();
      break;
    }
    case 'text': {
      // Simple text approximation: each character as a small rectangle
      // Full font rendering requires THREE.Font + glyph data
      const { x, y, content, fontSize = 10, rotation = 0 } = deco;
      const charW = fontSize * 0.6;
      const totalW = content.length * charW;
      const hw = totalW / 2;
      const hh = fontSize / 2;
      let corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      if (rotation !== 0) {
        corners = corners.map(c => rotatePoint(c[0], c[1], rotation));
      }
      corners = corners.map(c => [c[0] + x, c[1] + y]);
      path.moveTo(corners[0][0], corners[0][1]);
      for (let i = 1; i < corners.length; i++) {
        path.lineTo(corners[i][0], corners[i][1]);
      }
      path.closePath();
      break;
    }
  }

  return path;
}

function decorationToEngraveMesh(deco) {
  const shape = new THREE.Shape();
  const depth = 0.5;

  switch (deco.type) {
    case 'circle': {
      const { cx, cy, radius } = deco;
      shape.absarc(cx, cy, radius, 0, Math.PI * 2, false);
      break;
    }
    case 'rect': {
      const { x, y, width, height } = deco;
      const hw = width / 2;
      const hh = height / 2;
      shape.moveTo(x - hw, y - hh);
      shape.lineTo(x + hw, y - hh);
      shape.lineTo(x + hw, y + hh);
      shape.lineTo(x - hw, y + hh);
      shape.closePath();
      break;
    }
    case 'star': {
      const { cx, cy, outerR, innerR, points = 5, rotation = 0 } = deco;
      const step = Math.PI / points;
      shape.moveTo(
        cx + outerR * Math.cos(rotation - Math.PI / 2),
        cy + outerR * Math.sin(rotation - Math.PI / 2),
      );
      for (let i = 1; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = rotation - Math.PI / 2 + i * step;
        shape.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
      }
      shape.closePath();
      break;
    }
    case 'text': {
      const { x, y, content, fontSize = 10 } = deco;
      const charW = fontSize * 0.6;
      const totalW = content.length * charW;
      const hw = totalW / 2;
      const hh = fontSize / 2;
      shape.moveTo(x - hw, y - hh);
      shape.lineTo(x + hw, y - hh);
      shape.lineTo(x + hw, y + hh);
      shape.lineTo(x - hw, y + hh);
      shape.closePath();
      break;
    }
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  });

  const material = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
    metalness: 0.05,
    transparent: true,
    opacity: 0.85,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -depth * 0.5;
  return mesh;
}

function rotatePoint(x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}
