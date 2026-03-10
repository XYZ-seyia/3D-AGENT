export const MODEL_VERSION = '0.2.0';

export const AI_WRITABLE_FIELDS = {
  model: ['meta.name', 'meta.tags', 'meta.source'],
  primitive: [
    'primitive',
    'label',
    'params',
    'shape',
    'thickness',
    'material',
    'pose.position',
    'pose.rotation',
    'style.color',
  ],
  connection: [
    'panelA',
    'edgeA',
    'panelB',
    'edgeB',
    'joint.kind',
    'joint.kerf',
    'joint.edgeTypes',
    'joint.params',
    'meta.source',
  ],
  override: [
    'position_offset',
    'removed',
    'locked',
    'note',
  ],
};

export const SYSTEM_SOLVED_FIELDS = {
  panel: [
    'compiled.edgeStyles',
    'compiled.meshHints',
    'compiled.worldEdges',
  ],
  connection: [
    'meta.auto',
    'meta.score',
  ],
};

const DEFAULT_META = {
  name: '未命名结构',
  source: 'manual',
  tags: [],
};

export function createModel(partial = {}) {
  return normalizeModel({
    version: MODEL_VERSION,
    primitives: [],
    connections: [],
    overrides: {},
    decorations: {},
    annotations: {},
    meta: { ...DEFAULT_META },
    ...partial,
  });
}

export function normalizeModel(model = {}) {
  return {
    version: model.version || MODEL_VERSION,
    primitives: Array.isArray(model.primitives) ? model.primitives.map(normalizePrimitive) : [],
    connections: Array.isArray(model.connections) ? model.connections.map(normalizeConnection) : [],
    overrides: model.overrides ? structuredCloneSafe(model.overrides) : {},
    decorations: model.decorations ? structuredCloneSafe(model.decorations) : {},
    annotations: model.annotations ? structuredCloneSafe(model.annotations) : {},
    meta: { ...DEFAULT_META, ...(model.meta || {}) },
  };
}

export function normalizePrimitive(primitive = {}) {
  const base = {
    id: primitive.id || makeId(primitive.primitive || 'primitive'),
    primitive: primitive.primitive || 'panel',
    label: primitive.label || '',
    params: primitive.params ? structuredCloneSafe(primitive.params) : {},
    shape: primitive.shape ? structuredCloneSafe(primitive.shape) : { type: 'rect', width: 80, height: 60 },
    thickness: primitive.thickness ?? primitive.params?.thickness ?? 3,
    material: primitive.material ? structuredCloneSafe(primitive.material) : { name: 'plywood', thickness: primitive.thickness ?? primitive.params?.thickness ?? 3 },
    pose: normalizePose(primitive.pose),
    style: {
      color: primitive.style?.color ?? null,
      ...structuredCloneSafe(primitive.style || {}),
    },
    meta: structuredCloneSafe(primitive.meta || {}),
  };

  if (primitive.primitive === 'box' || primitive.primitive === 'polyhedron' || primitive.primitive === 'shelf' || primitive.primitive === 'lampshade') {
    base.shape = primitive.shape ? structuredCloneSafe(primitive.shape) : null;
  }

  return base;
}

export function normalizeConnection(connection = {}) {
  return {
    id: connection.id || makeId('connection'),
    panelA: connection.panelA || '',
    edgeA: connection.edgeA || '',
    panelB: connection.panelB || '',
    edgeB: connection.edgeB || '',
    joint: {
      kind: normalizeJointKind(connection.joint?.kind || connection.jointType || 'finger'),
      kerf: Number(connection.joint?.kerf ?? connection.kerf ?? 0),
      edgeTypes: Array.isArray(connection.joint?.edgeTypes)
        ? [...connection.joint.edgeTypes]
        : Array.isArray(connection.edgeTypes)
          ? [...connection.edgeTypes]
          : ['A', 'B'],
      params: connection.joint?.params ? structuredCloneSafe(connection.joint.params) : {},
      paramsA: connection.joint?.paramsA ? structuredCloneSafe(connection.joint.paramsA) : undefined,
      paramsB: connection.joint?.paramsB ? structuredCloneSafe(connection.joint.paramsB) : undefined,
    },
    meta: {
      source: connection.meta?.source || 'manual',
      auto: Boolean(connection.meta?.auto),
      score: connection.meta?.score ?? null,
      ...structuredCloneSafe(connection.meta || {}),
    },
  };
}

export function createPanelPrimitive(config = {}) {
  return normalizePrimitive({
    primitive: 'panel',
    shape: { type: 'rect', width: 80, height: 60 },
    pose: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...config,
  });
}

export function createMacroPrimitive(primitive, config = {}) {
  return normalizePrimitive({
    primitive,
    ...config,
  });
}

export function createConnection(config = {}) {
  return normalizeConnection(config);
}

export function getPrimitiveById(model, primitiveId) {
  return model.primitives.find(item => item.id === primitiveId) || null;
}

export function ensureOverride(model, primitiveId) {
  if (!model.overrides[primitiveId]) {
    model.overrides[primitiveId] = {};
  }
  return model.overrides[primitiveId];
}

export function normalizePose(pose = {}) {
  return {
    position: Array.isArray(pose?.position) ? [...pose.position] : [0, 0, 0],
    rotation: Array.isArray(pose?.rotation) ? [...pose.rotation] : [0, 0, 0],
  };
}

export function normalizeJointKind(kind) {
  if (kind === 'tab') return 'tab-slot';
  return kind || 'finger';
}

export function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function structuredCloneSafe(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
