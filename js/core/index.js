export {
  MODEL_VERSION,
  AI_WRITABLE_FIELDS,
  SYSTEM_SOLVED_FIELDS,
  createModel,
  normalizeModel,
  normalizePrimitive,
  normalizeConnection,
  createPanelPrimitive,
  createMacroPrimitive,
  createConnection,
  getPrimitiveById,
  ensureOverride,
  normalizePose,
  normalizeJointKind,
  makeId,
} from './schema.js';

export {
  cloneModel,
  addPrimitive,
  addRectPanel,
  upsertMacroPrimitive,
  removePrimitive,
  updatePrimitiveParams,
  movePrimitive,
  rotatePrimitive,
  setOverride,
  annotateEdge,
  clearAutoConnections,
  addConnection,
  detectAutoConnections,
  computeRectWorldEdges,
  cycleOrthogonalRotation,
} from './model-ops.js';

export {
  resolveKerfPolicy,
  resolveJointDepth,
  normalizeEdgeStyle,
  getBoxEdgeStyles,
  computeSharedEdgeTypes,
  validateJoint,
} from './joint-policies.js';

export {
  listJointTypes,
  getJointType,
  getJointDefaults,
  getJointParamSpecs,
  getJointConstraints,
  validateJointForEdge,
} from './joint-registry.js';

export {
  calcToothCount,
  buildRectJointShape,
  buildPolygonJointShape,
  createPanelMesh,
  buildCrossSlotMetadata,
  registerJointGeometry,
} from './joint-kernel.js';

export {
  compileModelToAssembly,
  compileBoxMacro,
  compilePolyhedronMacro,
  compileLampshadeMacro,
  compilePanelPrimitive,
} from './macro-models.js';

export {
  renderAssembly,
  setExplodeFactor,
} from './assembly-renderer.js';

export {
  listMacroTemplates,
  getMacroTemplate,
  createMacroTemplatePrimitive,
} from './macro-registry.js';

export {
  analyzePublishCandidates,
  buildPublishedModelPreview,
} from './publish-recognizers.js';
