/**
 * Main Three.js scene for the Platonic solids generator.
 * Sets up renderer, camera, lights, orbit controls, raycasting,
 * and bridges between UI, generator, and face editor.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generatePolyhedron, updateExplode } from './poly-generator.js';
import { initUI } from './poly-ui.js';
import { initFaceEditor, openFaceEditor } from './face-editor.js';

// ── Scene setup ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x1a1a2e);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(100, 80, 120);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(60, 100, 80);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
dirLight2.position.set(-40, -20, -60);
scene.add(dirLight2);

// Grid helper
const grid = new THREE.GridHelper(400, 40, 0x333355, 0x222244);
scene.add(grid);

// ── State ───────────────────────────────────────────────────────────────────

let currentGroup = null;
let currentParams = {
  solidType: 'cube',
  edgeLength: 60,
  thickness: 3,
  faceDecorations: {},
};
let explodeFactor = 0;

// ── Build / rebuild ─────────────────────────────────────────────────────────

export function rebuild() {
  if (currentGroup) {
    scene.remove(currentGroup);
    currentGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }
  currentGroup = generatePolyhedron(currentParams);
  scene.add(currentGroup);
  setExplode(explodeFactor);
}

export function setExplode(factor) {
  explodeFactor = factor;
  if (currentGroup) updateExplode(currentGroup, factor);
}

export function setParam(key, value) {
  currentParams[key] = value;
  rebuild();
}

export function getParams() {
  return currentParams;
}

export function setFaceDecoration(faceIndex, decorations) {
  if (!currentParams.faceDecorations) currentParams.faceDecorations = {};
  currentParams.faceDecorations[faceIndex] = decorations;
  rebuild();
}

// ── Raycasting for hover & double-click ─────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');

let hoveredMesh = null;
let originalColor = null;

function onMouseMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (!currentGroup) return;

  raycaster.setFromCamera(mouse, camera);
  const meshes = [];
  currentGroup.traverse(c => { if (c.isMesh && c.userData.faceIndex !== undefined) meshes.push(c); });
  const hits = raycaster.intersectObjects(meshes);

  if (hits.length > 0) {
    const mesh = hits[0].object;
    if (mesh !== hoveredMesh) {
      resetHover();
      hoveredMesh = mesh;
      originalColor = mesh.material.color.getHex();
      mesh.material.color.setHex(0xffffff);
      mesh.material.emissive.setHex(0x222244);
    }
    tooltip.textContent = `面 ${mesh.userData.faceIndex} | ${currentParams.solidType}`;
    tooltip.classList.add('visible');
  } else {
    resetHover();
    tooltip.classList.remove('visible');
  }
}

function resetHover() {
  if (hoveredMesh && originalColor !== null) {
    hoveredMesh.material.color.setHex(originalColor);
    hoveredMesh.material.emissive.setHex(0x000000);
    hoveredMesh = null;
    originalColor = null;
  }
}

function onDblClick(e) {
  if (!currentGroup) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = [];
  currentGroup.traverse(c => { if (c.isMesh && c.userData.faceIndex !== undefined) meshes.push(c); });
  const hits = raycaster.intersectObjects(meshes);

  if (hits.length > 0) {
    const mesh = hits[0].object;
    const fi = mesh.userData.faceIndex;
    const decos = (currentParams.faceDecorations && currentParams.faceDecorations[fi]) || [];
    openFaceEditor(fi, mesh.userData.verts2D, decos, currentParams.solidType);
  }
}

canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('dblclick', onDblClick);

// ── Resize ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Animation loop ──────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ── Init ────────────────────────────────────────────────────────────────────

initUI();
initFaceEditor();
rebuild();
animate();
