/**
 * Generate 3D panel assemblies for Platonic solids.
 * Each face → 2D jointed shape → ExtrudeGeometry → positioned in 3D.
 */
import * as THREE from 'three';
import { getScaledSolid } from './poly-data.js';
import { polygonJointShape } from './polygon-joint-utils.js';
import { applyDecorations } from './face-decorations.js';

const FACE_COLORS = [
  0x4fc3f7, 0x81c784, 0xffb74d, 0xe57373, 0xba68c8,
  0x4dd0e1, 0xaed581, 0xfff176, 0xf06292, 0x7986cb,
  0xa1887f, 0x90a4ae,
];

/**
 * Generate all panels for a polyhedron.
 *
 * @param {Object} params
 * @param {string} params.solidType   key from SOLIDS
 * @param {number} params.edgeLength  desired edge length
 * @param {number} params.thickness   material thickness
 * @param {Object} [params.faceDecorations]  map of faceIndex → decorations[]
 * @returns {THREE.Group}
 */
export function generatePolyhedron(params) {
  const { solidType, edgeLength, thickness, faceDecorations } = params;
  const solid = getScaledSolid(solidType, edgeLength);
  const group = new THREE.Group();

  for (let fi = 0; fi < solid.faces.length; fi++) {
    const verts2D = solid.faces2D[fi];
    const edgeTypes = solid.edgeTypes[fi];
    const basis = solid.faceBases[fi];

    let holes = null;
    if (faceDecorations && faceDecorations[fi]) {
      holes = applyDecorations(faceDecorations[fi], 'cut');
    }

    const shape = polygonJointShape(verts2D, thickness, edgeTypes, holes);
    const mesh = createFaceMesh(shape, thickness, fi);

    orientAndPosition(mesh, basis);

    mesh.userData = {
      faceIndex: fi,
      solidType,
      normal: [...basis.normal],
      center: [...basis.center],
      basePosition: null,
      verts2D: verts2D,
      edgeTypes: edgeTypes,
    };

    // Engrave decorations as separate meshes attached to the panel
    if (faceDecorations && faceDecorations[fi]) {
      const engraveMeshes = applyDecorations(faceDecorations[fi], 'engrave');
      if (engraveMeshes) {
        for (const em of engraveMeshes) {
          mesh.add(em);
        }
      }
    }

    group.add(mesh);
  }

  // Store base positions for explode animation
  group.traverse(child => {
    if (child.isMesh && child.userData.faceIndex !== undefined) {
      child.userData.basePosition = child.position.clone();
    }
  });

  return group;
}

function createFaceMesh(shape, thickness, faceIndex) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  const color = FACE_COLORS[faceIndex % FACE_COLORS.length];
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Orient a mesh (created in XY plane, extruded along +Z)
 * so that local +Z aligns with the face normal,
 * and position it at the face center.
 */
function orientAndPosition(mesh, basis) {
  const localX = new THREE.Vector3(...basis.localX);
  const localY = new THREE.Vector3(...basis.localY);
  const normal = new THREE.Vector3(...basis.normal);

  const rotMatrix = new THREE.Matrix4();
  rotMatrix.makeBasis(localX, localY, normal);

  mesh.applyMatrix4(rotMatrix);
  mesh.position.set(...basis.center);
}

/**
 * Update the exploded view: move each panel outward along its normal.
 *
 * @param {THREE.Group} group
 * @param {number} factor  0 = assembled, 1 = fully exploded
 * @param {number} maxDist  max explode distance
 */
export function updateExplode(group, factor, maxDist = 50) {
  group.traverse(child => {
    if (!child.isMesh || !child.userData.basePosition) return;
    const base = child.userData.basePosition;
    const n = child.userData.normal;
    if (!n) return;
    child.position.set(
      base.x + n[0] * factor * maxDist,
      base.y + n[1] * factor * maxDist,
      base.z + n[2] * factor * maxDist,
    );
  });
}
