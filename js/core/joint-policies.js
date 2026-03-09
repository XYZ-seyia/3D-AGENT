export function resolveKerfPolicy({ thickness, kerf = 0 }) {
  return {
    thickness,
    kerf,
    offset: kerf / 2,
  };
}

export function resolveJointDepth({ thickness, kerf = 0 }) {
  return thickness + kerf / 2;
}

export function normalizeEdgeStyle(style, fallbackKind = 'finger') {
  if (!style) return { jointKind: 'flat', edgeType: 'flat', kerf: 0 };
  if (typeof style === 'string') {
    if (style === 'flat') return { jointKind: 'flat', edgeType: 'flat', kerf: 0 };
    return { jointKind: fallbackKind, edgeType: style, kerf: 0 };
  }
  return {
    jointKind: style.jointKind === 'tab' ? 'tab-slot' : (style.jointKind || fallbackKind),
    edgeType: style.edgeType || 'flat',
    kerf: Number(style.kerf || 0),
  };
}

export function getBoxEdgeStyles(panelId, jointKind = 'finger', kerf = 0) {
  const resolvedKind = jointKind === 'tab' ? 'tab-slot' : jointKind;
  const specs = {
    front: { bottom: 'A', right: 'A', top: 'A', left: 'A' },
    back: { bottom: 'A', right: 'A', top: 'A', left: 'A' },
    left: { bottom: 'A', right: 'B', top: 'A', left: 'B' },
    right: { bottom: 'A', right: 'B', top: 'A', left: 'B' },
    bottom: { bottom: 'B', right: 'B', top: 'B', left: 'B' },
    top: { bottom: 'B', right: 'B', top: 'B', left: 'B' },
  };
  const current = specs[panelId];
  if (!current) return {};
  return Object.fromEntries(
    Object.entries(current).map(([edgeId, edgeType]) => [
      edgeId,
      { jointKind: resolvedKind, edgeType, kerf },
    ])
  );
}

export function computeSharedEdgeTypes(faces) {
  const edgeMap = new Map();
  const faceStyles = faces.map(() => []);

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex];
    for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex++) {
      const a = face[edgeIndex];
      const b = face[(edgeIndex + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, faceIndex);
        faceStyles[faceIndex][edgeIndex] = 'A';
      } else {
        const firstFace = edgeMap.get(key);
        faceStyles[faceIndex][edgeIndex] = faceIndex > firstFace ? 'B' : 'A';
      }
    }
  }

  return faceStyles;
}
