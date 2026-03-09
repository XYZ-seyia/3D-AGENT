import * as THREE from 'three';
import {
  createConnection,
  createPanelPrimitive,
  ensureOverride,
  getPrimitiveById,
  makeId,
  normalizeModel,
  normalizePose,
} from './schema.js';

const EDGE_IDS = ['bottom', 'right', 'top', 'left'];

export function cloneModel(model) {
  return normalizeModel(model);
}

export function addPrimitive(model, primitive) {
  model.primitives.push(primitive);
  return primitive;
}

export function addRectPanel(model, config = {}) {
  const primitive = createPanelPrimitive({
    id: config.id || makeId('panel'),
    label: config.label || '自由板',
    thickness: config.thickness ?? 3,
    material: { name: 'plywood', thickness: config.thickness ?? 3 },
    shape: {
      type: 'rect',
      width: config.width ?? 80,
      height: config.height ?? 60,
    },
    pose: normalizePose(config.pose),
    style: {
      color: config.color ?? 0xaed581,
    },
    meta: {
      source: config.source || 'manual',
    },
  });
  addPrimitive(model, primitive);
  return primitive;
}

export function upsertMacroPrimitive(model, primitive) {
  const index = model.primitives.findIndex(item => item.id === primitive.id);
  if (index >= 0) {
    model.primitives[index] = primitive;
  } else {
    model.primitives.push(primitive);
  }
  return primitive;
}

export function removePrimitive(model, primitiveId) {
  model.primitives = model.primitives.filter(item => item.id !== primitiveId);
  model.connections = model.connections.filter(item => item.panelA !== primitiveId && item.panelB !== primitiveId);
  delete model.overrides[primitiveId];
  delete model.decorations[primitiveId];
}

export function updatePrimitiveParams(model, primitiveId, paramsPatch) {
  const primitive = getPrimitiveById(model, primitiveId);
  if (!primitive) return null;
  primitive.params = {
    ...(primitive.params || {}),
    ...paramsPatch,
  };
  if (paramsPatch?.thickness != null && primitive.primitive === 'panel') {
    primitive.thickness = paramsPatch.thickness;
    primitive.material = {
      ...(primitive.material || {}),
      thickness: paramsPatch.thickness,
    };
  }
  return primitive;
}

export function movePrimitive(model, primitiveId, position) {
  const primitive = getPrimitiveById(model, primitiveId);
  if (!primitive) return null;
  primitive.pose = normalizePose(primitive.pose);
  primitive.pose.position = [...position];
  return primitive;
}

export function rotatePrimitive(model, primitiveId, rotation) {
  const primitive = getPrimitiveById(model, primitiveId);
  if (!primitive) return null;
  primitive.pose = normalizePose(primitive.pose);
  primitive.pose.rotation = [...rotation];
  return primitive;
}

export function setOverride(model, primitiveId, patch) {
  const override = ensureOverride(model, primitiveId);
  Object.assign(override, patch);
  return override;
}

export function annotateEdge(model, primitiveId, edgeId, annotation) {
  if (!model.annotations[primitiveId]) {
    model.annotations[primitiveId] = {};
  }
  model.annotations[primitiveId][edgeId] = {
    ...(model.annotations[primitiveId][edgeId] || {}),
    ...annotation,
  };
  return model.annotations[primitiveId][edgeId];
}

export function clearAutoConnections(model) {
  model.connections = model.connections.filter(item => !item.meta?.auto);
}

export function addConnection(model, config = {}) {
  const connection = createConnection(config);
  const existingIndex = model.connections.findIndex(item =>
    sameConnection(item, connection) || item.id === connection.id
  );
  if (existingIndex >= 0) {
    model.connections[existingIndex] = connection;
  } else {
    model.connections.push(connection);
  }
  return connection;
}

export function detectAutoConnections(model, options = {}) {
  const threshold = options.threshold ?? 6;
  const jointKind = options.jointKind || 'finger';
  const panels = model.primitives.filter(item => item.primitive === 'panel' && item.shape?.type === 'rect');

  clearAutoConnections(model);

  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const panelA = panels[i];
      const panelB = panels[j];
      const edgesA = computeRectWorldEdges(panelA);
      const edgesB = computeRectWorldEdges(panelB);
      for (const edgeA of edgesA) {
        for (const edgeB of edgesB) {
          const score = edgeCoincidenceScore(edgeA, edgeB);
          if (score > threshold) continue;
          addConnection(model, {
            panelA: panelA.id,
            edgeA: edgeA.id,
            panelB: panelB.id,
            edgeB: edgeB.id,
            joint: {
              kind: jointKind,
              kerf: options.kerf ?? 0,
              edgeTypes: pickEdgeTypes(panelA.id, panelB.id),
            },
            meta: {
              source: 'system',
              auto: true,
              score,
            },
          });
        }
      }
    }
  }
}

export function computeRectWorldEdges(panel) {
  const pose = normalizePose(panel.pose);
  const matrix = buildPanelMatrix(pose);
  const width = panel.shape?.width ?? 80;
  const height = panel.shape?.height ?? 60;
  const localSegments = {
    bottom: [[0, 0, 0], [width, 0, 0]],
    right: [[width, 0, 0], [width, height, 0]],
    top: [[width, height, 0], [0, height, 0]],
    left: [[0, height, 0], [0, 0, 0]],
  };

  return EDGE_IDS.map(edgeId => {
    const [start, end] = localSegments[edgeId];
    return {
      id: edgeId,
      start: transformPoint(start, matrix),
      end: transformPoint(end, matrix),
      normal: transformDirection([0, 0, 1], matrix),
    };
  });
}

export function cycleOrthogonalRotation(panel) {
  const preset = [
    [0, 0, 0],
    [0, Math.PI / 2, 0],
    [-Math.PI / 2, 0, 0],
  ];
  const current = normalizePose(panel.pose).rotation;
  const index = preset.findIndex(item => sameTriplet(item, current));
  return preset[(index + 1) % preset.length];
}

function edgeCoincidenceScore(edgeA, edgeB) {
  const dot = Math.abs(edgeA.normal.dot(edgeB.normal));
  if (dot > 0.2) return Number.POSITIVE_INFINITY;

  const direct = edgeA.start.distanceTo(edgeB.start) + edgeA.end.distanceTo(edgeB.end);
  const reversed = edgeA.start.distanceTo(edgeB.end) + edgeA.end.distanceTo(edgeB.start);
  return Math.min(direct, reversed);
}

function pickEdgeTypes(idA, idB) {
  return idA < idB ? ['A', 'B'] : ['B', 'A'];
}

function buildPanelMatrix(pose) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(...pose.position);
  const rotation = new THREE.Euler(...pose.rotation, 'XYZ');
  matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1));
  return matrix;
}

function transformPoint(point, matrix) {
  return new THREE.Vector3(...point).applyMatrix4(matrix);
}

function transformDirection(point, matrix) {
  return new THREE.Vector3(...point).transformDirection(matrix);
}

function sameConnection(connectionA, connectionB) {
  return (
    connectionA.panelA === connectionB.panelA &&
    connectionA.edgeA === connectionB.edgeA &&
    connectionA.panelB === connectionB.panelB &&
    connectionA.edgeB === connectionB.edgeB
  ) || (
    connectionA.panelA === connectionB.panelB &&
    connectionA.edgeA === connectionB.edgeB &&
    connectionA.panelB === connectionB.panelA &&
    connectionA.edgeB === connectionB.edgeA
  );
}

function sameTriplet(a, b) {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.001);
}
