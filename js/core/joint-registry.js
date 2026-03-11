const JOINT_TYPE_DEFS = {
  finger: {
    id: 'finger',
    label: '指接榫',
    icon: '🪚',
    description: '交替齿槽咬合，强度高，适合大多数板材拼装',
    params: {
      kerf: { default: 0, min: 0, max: 1, step: 0.05, unit: 'mm', label: '激光切缝补偿' },
    },
    constraints: {
      minThickness: 2,
      maxThickness: 20,
      minEdgeLength: 15,
      compatibleMaterials: ['plywood', 'mdf', 'acrylic', 'cardboard'],
    },
    geometryFn: 'finger',
    editorReady: true,
  },

  'tab-slot': {
    id: 'tab-slot',
    label: '卡舌卡槽',
    icon: '🔩',
    description: '边缘板突出卡舌、腹部板对应位置凹入卡槽，卡舌插入卡槽形成连接',
    params: {
      kerf: { default: 0, min: 0, max: 1, step: 0.05, unit: 'mm', label: '激光切缝补偿' },
    },
    constraints: {
      minThickness: 2,
      maxThickness: 20,
      minEdgeLength: 20,
      compatibleMaterials: ['plywood', 'mdf', 'acrylic', 'cardboard'],
    },
    geometryFn: 'tab-slot',
    editorReady: true,
  },

  'tab-mortise': {
    id: 'tab-mortise',
    label: '卡榫卡槽',
    icon: '🔲',
    description: '板片边缘垂直接触另一板面，生成凸起卡榫与对应矩形凹槽',
    params: {
      tabWidth:  { default: 10, min: 4, max: 50, step: 1, unit: 'mm', label: '卡榫宽度' },
      tabCount:  { default: 0, min: 0, max: 20, step: 1, unit: '', label: '卡榫数量（0=自动）' },
      tolerance: { default: 0.15, min: 0, max: 1, step: 0.05, unit: 'mm', label: '公差' },
      kerf:      { default: 0, min: 0, max: 1, step: 0.05, unit: 'mm', label: '激光切缝补偿' },
    },
    constraints: {
      minThickness: 2,
      maxThickness: 20,
      minEdgeLength: 15,
      compatibleMaterials: ['plywood', 'mdf', 'acrylic'],
    },
    geometryFn: 'tab-mortise',
    editorReady: false,
  },

  'cross-slot': {
    id: 'cross-slot',
    label: '板片交叉',
    icon: '✛',
    description: '两板相交，各开一个凹槽相互嵌入，形成稳定十字或多边形结构',
    params: {
      kerf:         { default: 0, min: 0, max: 1, step: 0.05, unit: 'mm', label: '激光切缝补偿' },
      depthRatio:   { default: 0.5, min: 0.2, max: 0.8, step: 0.05, unit: '', label: '槽深比例' },
      slotPosition: { default: 0.5, min: 0.1, max: 0.9, step: 0.05, unit: '', label: '槽位置' },
    },
    constraints: {
      minThickness: 2,
      maxThickness: 20,
      minEdgeLength: 20,
      compatibleMaterials: ['plywood', 'mdf', 'acrylic'],
    },
    geometryFn: 'cross-slot',
    editorReady: true,
  },

  flat: {
    id: 'flat',
    label: '平接',
    icon: '➖',
    description: '无接合轮廓，边缘保持平直，需胶合或外部固定',
    params: {},
    constraints: {
      minThickness: 1,
      maxThickness: 50,
      minEdgeLength: 5,
      compatibleMaterials: ['plywood', 'mdf', 'acrylic', 'cardboard'],
    },
    geometryFn: 'flat',
    editorReady: true,
  },
};

export function listJointTypes(filter = {}) {
  let types = Object.values(JOINT_TYPE_DEFS);

  if (filter.editorReady != null) {
    types = types.filter(item => item.editorReady === filter.editorReady);
  }
  if (filter.minThickness != null) {
    types = types.filter(item =>
      item.constraints.minThickness <= filter.minThickness &&
      item.constraints.maxThickness >= filter.minThickness
    );
  }
  if (filter.material) {
    types = types.filter(item =>
      item.constraints.compatibleMaterials.includes(filter.material)
    );
  }

  return types.map(item => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    description: item.description,
    editorReady: item.editorReady,
  }));
}

export function getJointType(id) {
  return JOINT_TYPE_DEFS[id] || null;
}

export function getJointDefaults(id) {
  const def = JOINT_TYPE_DEFS[id];
  if (!def) return null;
  const defaults = {};
  for (const [key, spec] of Object.entries(def.params || {})) {
    defaults[key] = spec.default;
  }
  return defaults;
}

export function getJointParamSpecs(id) {
  const def = JOINT_TYPE_DEFS[id];
  if (!def) return null;
  return def.params || {};
}

export function getJointConstraints(id) {
  const def = JOINT_TYPE_DEFS[id];
  if (!def) return null;
  return def.constraints || {};
}

export function validateJointForEdge(jointKind, thickness, edgeLength, material) {
  const def = JOINT_TYPE_DEFS[jointKind];
  if (!def) return { valid: false, reason: `未知接合类型: ${jointKind}` };

  const c = def.constraints;
  if (thickness < c.minThickness) {
    return { valid: false, reason: `板厚 ${thickness}mm 低于最小要求 ${c.minThickness}mm` };
  }
  if (thickness > c.maxThickness) {
    return { valid: false, reason: `板厚 ${thickness}mm 超过最大限制 ${c.maxThickness}mm` };
  }
  if (edgeLength < c.minEdgeLength) {
    return { valid: false, reason: `边长 ${edgeLength}mm 低于最小要求 ${c.minEdgeLength}mm` };
  }
  if (material && !c.compatibleMaterials.includes(material)) {
    return { valid: false, reason: `材料 ${material} 不兼容此接合方式` };
  }
  return { valid: true, reason: null };
}
