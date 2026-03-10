import { createMacroPrimitive, createModel, normalizeModel } from './schema.js';
import { computeRectWorldEdges } from './model-ops.js';

const DIM_TOLERANCE = 0.5;
const POSITION_TOLERANCE = 3;

export function analyzePublishCandidates(model) {
  const normalized = normalizeModel(model);
  const summary = {
    primitiveCount: normalized.primitives.length,
    panelCount: normalized.primitives.filter(item => item.primitive === 'panel').length,
    macroCount: normalized.primitives.filter(item => item.primitive !== 'panel').length,
    connectionCount: normalized.connections.length,
  };

  const candidates = [buildFreeAssemblyCandidate(normalized)];
  const existingBox = recognizeExistingBoxMacro(normalized);
  if (existingBox) {
    candidates.unshift(existingBox);
  } else {
    const boxCandidate = recognizePanelAssemblyAsBox(normalized);
    if (boxCandidate) candidates.unshift(boxCandidate);
  }

  return { summary, candidates };
}

export function buildPublishedModelPreview(model, options = {}) {
  const mode = options.mode === 'macro' ? 'macro' : 'freeAssembly';
  if (mode === 'macro' && options.candidate) {
    return buildMacroPublishPreview(model, options.candidate, {
      retainedParams: options.retainedParams || {},
    });
  }
  return buildFreeAssemblyPreview(model);
}

function buildFreeAssemblyCandidate(model) {
  return {
    id: 'free-assembly',
    kind: 'freeAssembly',
    primitiveType: null,
    confidence: 'high',
    retainedParams: [],
    preservedFields: [
      'primitives',
      'connections',
      'overrides',
      'decorations',
      'meta',
    ],
    droppedFields: [],
    proposedParams: null,
    reasons: [
      '保持当前 panel + connections 的自由结构，不做抽象合并。',
    ],
  };
}

function recognizeExistingBoxMacro(model) {
  if (model.primitives.length !== 1) return null;
  const primitive = model.primitives[0];
  if (primitive.primitive !== 'box') return null;

  return {
    id: `box-existing-${primitive.id}`,
    kind: 'macroCandidate',
    primitiveType: 'box',
    source: 'existing-macro',
    sourcePrimitiveId: primitive.id,
    confidence: 'high',
    retainedParams: ['length', 'width', 'height', 'thickness', 'joint'],
    preservedFields: [
      'params.length',
      'params.width',
      'params.height',
      'params.thickness',
      'joints.type',
      'overrides',
      'decorations',
      'meta',
    ],
    droppedFields: [],
    proposedParams: {
      length: primitive.params?.length ?? 120,
      width: primitive.params?.width ?? 80,
      height: primitive.params?.height ?? 60,
      thickness: primitive.params?.thickness ?? primitive.thickness ?? 3,
      joint: primitive.joints?.type || 'finger',
    },
    proposedPose: primitive.pose || { position: [0, 0, 0], rotation: [0, 0, 0] },
    reasons: [
      '当前结构已经是 box 组件，可直接按组件方式发布。',
    ],
  };
}

function recognizePanelAssemblyAsBox(model) {
  const panels = model.primitives.filter(item => item.primitive === 'panel' && item.shape?.type === 'rect');
  if (panels.length !== model.primitives.length || panels.length !== 6) return null;
  if (!hasReasonableBoxConnectivity(model, panels)) return null;

  const thickness = panels[0]?.thickness ?? panels[0]?.material?.thickness ?? 3;
  if (!panels.every(panel => almostEqual(panel.thickness ?? panel.material?.thickness ?? thickness, thickness))) {
    return null;
  }

  const grouped = groupPanelsByDominantAxis(panels);
  if (!grouped) return null;

  const faceMap = buildFaceMap(grouped);
  const front = grouped.z[0];
  const back = grouped.z[1];
  const left = grouped.x[0];
  const right = grouped.x[1];
  const bottom = grouped.y[0];
  const top = grouped.y[1];

  const length = average([front.shape.width, back.shape.width, bottom.shape.width, top.shape.width]);
  const width = average([left.shape.width, right.shape.width, bottom.shape.height, top.shape.height]);
  const height = average([front.shape.height, back.shape.height, left.shape.height, right.shape.height]);

  const lengthValid = [front.shape.width, back.shape.width, bottom.shape.width, top.shape.width].every(v => almostEqual(v, length));
  const widthValid = [left.shape.width, right.shape.width, bottom.shape.height, top.shape.height].every(v => almostEqual(v, width));
  const heightValid = [front.shape.height, back.shape.height, left.shape.height, right.shape.height].every(v => almostEqual(v, height));
  if (!lengthValid || !widthValid || !heightValid) return null;

  const joint = inferJointKind(model);
  const expectedPositions = {
    front: [-length / 2, 0, -width / 2 - thickness],
    back: [-length / 2, 0, width / 2],
    left: [-length / 2 - thickness, 0, width / 2],
    right: [length / 2, 0, width / 2],
    bottom: [-length / 2, -thickness, width / 2],
    top: [-length / 2, height, width / 2],
  };
  const pose = inferAssemblyPose(panels, faceMap, expectedPositions);

  const droppedFields = analyzeDroppedFields(model, panels);
  const reasons = [
    '检测到 6 块矩形 panel，可分为前后、左右、顶底三组。',
    `可归纳为 box 参数：${fmt(length)} x ${fmt(width)} x ${fmt(height)} mm，厚度 ${fmt(thickness)} mm。`,
    `当前连接数 ${model.connections.length}，适合在发布时封装为 box 组件。`,
  ];

  return {
    id: 'box-candidate',
    kind: 'macroCandidate',
    primitiveType: 'box',
    source: 'panel-assembly',
    sourcePrimitiveId: null,
    confidence: model.connections.length >= 8 && droppedFields.length === 0 ? 'high' : 'medium',
    retainedParams: ['length', 'width', 'height', 'thickness', 'joint'],
    preservedFields: [
      'params.length',
      'params.width',
      'params.height',
      'params.thickness',
      'joints.type',
      'overrides',
      'decorations',
      'meta',
    ],
    droppedFields,
    proposedParams: {
      length: roundMetric(length),
      width: roundMetric(width),
      height: roundMetric(height),
      thickness: roundMetric(thickness),
      joint,
    },
    proposedPose: pose,
    faceMap,
    reasons,
  };
}

function buildFreeAssemblyPreview(model) {
  const preview = normalizeModel(model);
  preview.meta = {
    ...preview.meta,
    source: 'editor-publish',
    publishMode: 'free-assembly',
    publish: {
      mode: 'free-assembly',
    },
  };
  return preview;
}

function buildMacroPublishPreview(model, candidate, options = {}) {
  if (candidate.source === 'existing-macro') {
    const preview = normalizeModel(model);
    const retainedParams = normalizeRetainedParams(candidate, options.retainedParams);
    preview.meta = {
      ...preview.meta,
      source: 'editor-publish',
      publishMode: 'macro',
      publish: {
        mode: 'macro',
        primitiveType: 'box',
        retainedParams,
      },
    };
    const primitive = preview.primitives[0];
    primitive.meta = {
      ...(primitive.meta || {}),
      publish: {
        retainedParams,
      },
    };
    return preview;
  }

  const retainedParams = normalizeRetainedParams(candidate, options.retainedParams);
  const boxId = 'published_box_1';
  const boxPrimitive = createMacroPrimitive('box', {
    id: boxId,
    label: '发布盒子',
    params: {
      length: candidate.proposedParams.length,
      width: candidate.proposedParams.width,
      height: candidate.proposedParams.height,
      thickness: candidate.proposedParams.thickness,
    },
    joints: {
      type: candidate.proposedParams.joint || 'finger',
    },
    pose: candidate.proposedPose || { position: [0, 0, 0], rotation: [0, 0, 0] },
    meta: {
      source: 'editor-publish',
      publish: {
        retainedParams,
        candidateId: candidate.id,
      },
    },
  });

  const preview = createModel({
    primitives: [boxPrimitive],
    connections: [],
    overrides: remapFaceScopedMap(model.overrides || {}, candidate.faceMap, boxId),
    decorations: remapFaceScopedMap(model.decorations || {}, candidate.faceMap, boxId),
    meta: {
      ...model.meta,
      source: 'editor-publish',
      publishMode: 'macro',
      publish: {
        mode: 'macro',
        primitiveType: 'box',
        retainedParams,
      },
    },
  });

  return preview;
}

function groupPanelsByDominantAxis(panels) {
  const grouped = { x: [], y: [], z: [] };
  for (const panel of panels) {
    const edges = computeRectWorldEdges(panel);
    const normal = edges[0]?.normal;
    if (!normal) return null;
    const classified = classifyAxis(normal);
    if (!classified) return null;
    grouped[classified.axis].push(panel);
  }
  if (grouped.x.length !== 2 || grouped.y.length !== 2 || grouped.z.length !== 2) return null;

  grouped.x.sort((a, b) => (a.pose?.position?.[0] || 0) - (b.pose?.position?.[0] || 0));
  grouped.y.sort((a, b) => (a.pose?.position?.[1] || 0) - (b.pose?.position?.[1] || 0));
  grouped.z.sort((a, b) => (a.pose?.position?.[2] || 0) - (b.pose?.position?.[2] || 0));
  return grouped;
}

function buildFaceMap(grouped) {
  return {
    [grouped.z[0].id]: 'front',
    [grouped.z[1].id]: 'back',
    [grouped.x[0].id]: 'left',
    [grouped.x[1].id]: 'right',
    [grouped.y[0].id]: 'bottom',
    [grouped.y[1].id]: 'top',
  };
}

function inferAssemblyPose(panels, faceMap, expectedPositions) {
  const panelMap = new Map(panels.map(panel => [panel.id, panel]));
  const deltas = [];
  for (const [panelId, panelKey] of Object.entries(faceMap)) {
    const panel = panelMap.get(panelId);
    const expected = expectedPositions[panelKey];
    const position = panel?.pose?.position || [0, 0, 0];
    deltas.push([
      position[0] - expected[0],
      position[1] - expected[1],
      position[2] - expected[2],
    ]);
  }
  const averageDelta = [
    average(deltas.map(item => item[0])),
    average(deltas.map(item => item[1])),
    average(deltas.map(item => item[2])),
  ];
  const consistent = deltas.every(item =>
    almostEqual(item[0], averageDelta[0], POSITION_TOLERANCE) &&
    almostEqual(item[1], averageDelta[1], POSITION_TOLERANCE) &&
    almostEqual(item[2], averageDelta[2], POSITION_TOLERANCE)
  );
  return {
    position: consistent ? averageDelta.map(value => roundMetric(value)) : [0, 0, 0],
    rotation: [0, 0, 0],
  };
}

function inferJointKind(model) {
  const kinds = model.connections.map(item => item.joint?.kind).filter(Boolean);
  if (kinds.length === 0) return 'finger';
  const counts = new Map();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] === 'tab-slot' ? 'tab' : [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function analyzeDroppedFields(model, panels) {
  const dropped = [];
  const colors = new Set(panels.map(panel => panel.style?.color).filter(value => value != null));
  if (colors.size > 1) dropped.push('每块 panel 的独立颜色');
  if (Object.keys(model.annotations || {}).length > 0) dropped.push('annotations 注释数据');
  if (panels.some(panel => panel.label && !/^面板\d+$/.test(panel.label))) dropped.push('自由 panel 标签');
  return dropped;
}

function hasReasonableBoxConnectivity(model, panels) {
  if ((model.connections || []).length < 6) return false;
  const counts = new Map(panels.map(panel => [panel.id, 0]));
  for (const connection of model.connections || []) {
    if (counts.has(connection.panelA)) counts.set(connection.panelA, counts.get(connection.panelA) + 1);
    if (counts.has(connection.panelB)) counts.set(connection.panelB, counts.get(connection.panelB) + 1);
  }
  return [...counts.values()].every(count => count >= 2);
}

function remapFaceScopedMap(sourceMap, faceMap, macroId) {
  const result = {};
  for (const [panelId, payload] of Object.entries(sourceMap || {})) {
    const panelKey = faceMap?.[panelId];
    if (!panelKey) continue;
    result[`${macroId}:${panelKey}`] = structuredClone(payload);
  }
  return result;
}

function normalizeRetainedParams(candidate, retainedParams) {
  return (candidate.retainedParams || []).filter(key => retainedParams[key] !== false);
}

function classifyAxis(normal) {
  const components = [
    ['x', Math.abs(normal.x)],
    ['y', Math.abs(normal.y)],
    ['z', Math.abs(normal.z)],
  ].sort((a, b) => b[1] - a[1]);
  if (components[0][1] < 0.85) return null;
  return { axis: components[0][0] };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function almostEqual(a, b, tolerance = DIM_TOLERANCE) {
  return Math.abs(a - b) <= tolerance;
}

function roundMetric(value, precision = 0.1) {
  return Math.round(value / precision) * precision;
}

function fmt(value) {
  const rounded = roundMetric(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function structuredClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
