import { createMacroPrimitive, makeId, normalizePose } from './schema.js';

const MACRO_TEMPLATE_DEFS = {
  box: {
    id: 'box',
    editorReady: true,
    label: '基础盒子',
    description: '参数化盒子模板，可展开为六个拼装面板。',
    icon: '📦',
    primitive: 'box',
    style: { color: 0x818cf8 },
    params: {
      length: 120,
      width: 80,
      height: 60,
      thickness: 3,
    },
    joints: { type: 'finger' },
  },
  polyhedron: {
    id: 'polyhedron',
    editorReady: false,
    label: '正多面体',
    description: '参数化正多面体模板，可展开为多边形面板。',
    icon: '🔷',
    primitive: 'polyhedron',
    style: { color: 0x4fc3f7 },
    params: {
      solidType: 'cube',
      edgeLength: 70,
      thickness: 3,
    },
    joints: { type: 'finger' },
  },
  lampshade: {
    id: 'lampshade',
    editorReady: true,
    label: '灯罩',
    description: '板片插接灯罩：上下圆环 + 径向肋片。',
    icon: '💡',
    primitive: 'lampshade',
    style: { color: null },
    params: {
      outerRadius: 80,
      innerRadius: 25,
      height: 120,
      ribCount: 12,
      thickness: 3,
    },
  },
};

export function listMacroTemplates() {
  return Object.values(MACRO_TEMPLATE_DEFS).map(item => ({
    id: item.id,
    editorReady: item.editorReady !== false,
    label: item.label,
    description: item.description,
    icon: item.icon,
    primitive: item.primitive,
  }));
}

export function getMacroTemplate(templateId) {
  return MACRO_TEMPLATE_DEFS[templateId] || null;
}

export function createMacroTemplatePrimitive(templateId, options = {}) {
  const template = getMacroTemplate(templateId);
  if (!template) return null;

  return createMacroPrimitive(template.primitive, {
    id: options.id || makeId(template.primitive),
    label: options.label || template.label,
    params: {
      ...template.params,
      ...(options.params || {}),
    },
    joints: {
      ...(template.joints || {}),
      ...(options.joints || {}),
    },
    pose: normalizePose(options.pose),
    style: {
      ...(template.style || {}),
      ...(options.style || {}),
    },
    meta: {
      source: 'macro-template',
      templateId,
      ...(options.meta || {}),
    },
  });
}
