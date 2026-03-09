/**
 * Geometric data for the 5 Platonic solids.
 *
 * Each solid is defined by raw vertex coordinates at a convenient scale.
 * At runtime, vertices are scaled to the desired edgeLength.
 * Faces, edges, normals, and local coordinate systems are computed automatically.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

// ── Raw definitions (unscaled) ──────────────────────────────────────────────

const RAW = {
  tetrahedron: {
    verts: [
      [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
    ],
    rawEdgeLen: 2 * Math.SQRT2,
    sidesPerFace: 3,
  },
  cube: {
    verts: [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ],
    rawEdgeLen: 2,
    sidesPerFace: 4,
  },
  octahedron: {
    verts: [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ],
    rawEdgeLen: Math.SQRT2,
    sidesPerFace: 3,
  },
  dodecahedron: {
    verts: [
      [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
      [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
      [0, 1 / PHI, PHI], [0, 1 / PHI, -PHI], [0, -1 / PHI, PHI], [0, -1 / PHI, -PHI],
      [1 / PHI, PHI, 0], [1 / PHI, -PHI, 0], [-1 / PHI, PHI, 0], [-1 / PHI, -PHI, 0],
      [PHI, 0, 1 / PHI], [PHI, 0, -1 / PHI], [-PHI, 0, 1 / PHI], [-PHI, 0, -1 / PHI],
    ],
    rawEdgeLen: 2 / PHI,
    sidesPerFace: 5,
  },
  icosahedron: {
    verts: [
      [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI],
      [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0],
      [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1],
    ],
    rawEdgeLen: 2,
    sidesPerFace: 3,
  },
};

// ── Geometry helpers ────────────────────────────────────────────────────────

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function normalize3(v) {
  const len = Math.hypot(...v);
  return len > 0 ? v.map(c => c / len) : [0, 0, 0];
}

function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

// ── Edge and face finding ───────────────────────────────────────────────────

function findEdges(verts, edgeLen) {
  const eps = edgeLen * 0.01;
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (Math.abs(dist(verts[i], verts[j]) - edgeLen) < eps) {
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

function buildAdj(verts, edges) {
  const adj = Array.from({ length: verts.length }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

function findTriFaces(verts, adj) {
  const faceSet = new Set();
  const faces = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    for (const j of adj[i]) {
      if (j <= i) continue;
      for (const k of adj[j]) {
        if (k <= j) continue;
        if (adj[i].includes(k)) {
          const key = [i, j, k].join(',');
          if (!faceSet.has(key)) {
            faceSet.add(key);
            faces.push([i, j, k]);
          }
        }
      }
    }
  }
  return faces;
}

function findQuadFaces(verts, adj) {
  // For the cube: hardcoded since quad-finding is ambiguous in general
  return [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3],
    [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2],
  ];
}

function findPentFaces(verts, adj) {
  const faceSet = new Set();
  const faces = [];
  for (let a = 0; a < verts.length; a++) {
    for (const b of adj[a]) {
      for (const c of adj[b]) {
        if (c === a) continue;
        for (const d of adj[c]) {
          if (d === a || d === b) continue;
          for (const e of adj[d]) {
            if (e === a || e === b || e === c) continue;
            if (adj[e].includes(a)) {
              const sorted = [a, b, c, d, e].sort((x, y) => x - y);
              const key = sorted.join(',');
              if (!faceSet.has(key)) {
                faceSet.add(key);
                faces.push([a, b, c, d, e]);
              }
            }
          }
        }
      }
    }
  }
  return faces;
}

/**
 * Orient a face so its normal (via right-hand rule) points outward from origin.
 */
function orientFace(verts, face) {
  const v0 = verts[face[0]];
  const v1 = verts[face[1]];
  const v2 = verts[face[2]];
  const normal = cross3(sub3(v1, v0), sub3(v2, v0));
  const center = faceCenter(verts, face);
  if (dot3(normal, center) < 0) {
    return [...face].reverse();
  }
  return [...face];
}

function faceCenter(verts, face) {
  const s = [0, 0, 0];
  for (const i of face) {
    s[0] += verts[i][0]; s[1] += verts[i][1]; s[2] += verts[i][2];
  }
  return s.map(c => c / face.length);
}

// ── Build edge-face adjacency and A/B types ─────────────────────────────────

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function buildEdgeFaceAdj(faces) {
  const map = {};
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const n = f.length;
    for (let i = 0; i < n; i++) {
      const key = edgeKey(f[i], f[(i + 1) % n]);
      if (!map[key]) map[key] = [];
      map[key].push(fi);
    }
  }
  return map;
}

/**
 * For each face, compute the edge types ('A' or 'B') for each of its edges.
 * Rule: for edge shared by face F1 and F2 (F1 < F2), F1 gets 'A', F2 gets 'B'.
 */
function computeEdgeTypes(faces, edgeFaceAdj) {
  return faces.map((face, fi) => {
    const n = face.length;
    const types = [];
    for (let i = 0; i < n; i++) {
      const key = edgeKey(face[i], face[(i + 1) % n]);
      const [f1, f2] = edgeFaceAdj[key];
      types.push(fi === Math.min(f1, f2) ? 'A' : 'B');
    }
    return types;
  });
}

// ── Face local coordinate system ────────────────────────────────────────────

function computeFaceBasis(verts, face) {
  const center = faceCenter(verts, face);
  const v0 = verts[face[0]];
  const v1 = verts[face[1]];
  const normal = normalize3(cross3(sub3(v1, v0), sub3(verts[face[2]], v0)));
  const localX = normalize3(sub3(v0, center));
  const localY = normalize3(cross3(normal, localX));
  return { center, normal, localX, localY };
}

/**
 * Project face vertices into the face's 2D local coordinate system.
 */
function projectFaceTo2D(verts, face, basis) {
  return face.map(i => {
    const d = sub3(verts[i], basis.center);
    return [dot3(d, basis.localX), dot3(d, basis.localY)];
  });
}

// ── Main build function ─────────────────────────────────────────────────────

function buildSolid(name) {
  const raw = RAW[name];
  const scale = 1 / raw.rawEdgeLen;
  const verts = raw.verts.map(v => v.map(c => c * scale));
  const edges = findEdges(verts, 1.0);
  const adj = buildAdj(verts, edges);

  let rawFaces;
  if (raw.sidesPerFace === 3) rawFaces = findTriFaces(verts, adj);
  else if (raw.sidesPerFace === 4) rawFaces = findQuadFaces(verts, adj);
  else rawFaces = findPentFaces(verts, adj);

  const faces = rawFaces.map(f => orientFace(verts, f));
  const edgeFaceAdj = buildEdgeFaceAdj(faces);
  const edgeTypes = computeEdgeTypes(faces, edgeFaceAdj);
  const faceBases = faces.map(f => computeFaceBasis(verts, f));
  const faces2D = faces.map((f, i) => projectFaceTo2D(verts, f, faceBases[i]));

  return {
    name,
    sidesPerFace: raw.sidesPerFace,
    vertices: verts,
    faces,
    edges,
    edgeTypes,
    faceBases,
    faces2D,
    edgeFaceAdj,
  };
}

// ── Pre-build all solids (unit edge length) ────────────────────────────────

export const SOLIDS = {};
for (const name of Object.keys(RAW)) {
  SOLIDS[name] = buildSolid(name);
}

export const SOLID_NAMES = {
  tetrahedron: '正四面体',
  cube: '正六面体',
  octahedron: '正八面体',
  dodecahedron: '正十二面体',
  icosahedron: '正二十面体',
};

/**
 * Return solid data scaled to a given edge length.
 * Face 2D vertices are scaled, 3D vertices are scaled, bases are recomputed.
 */
export function getScaledSolid(name, edgeLength) {
  const solid = SOLIDS[name];
  const s = edgeLength;
  const verts = solid.vertices.map(v => v.map(c => c * s));
  const faceBases = solid.faces.map(f => computeFaceBasis(verts, f));
  const faces2D = solid.faces.map((f, i) => projectFaceTo2D(verts, f, faceBases[i]));
  return { ...solid, vertices: verts, faceBases, faces2D };
}
