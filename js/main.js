import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateBox, setExplodeFactor } from './box-generator.js';
import { initControls } from './ui-controls.js';

const canvas = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(120, 100, 160);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(80, 120, 100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
fillLight.position.set(-60, 40, -60);
scene.add(fillLight);

const gridHelper = new THREE.GridHelper(400, 40, 0x0f3460, 0x0a1a3a);
scene.add(gridHelper);

let boxGroup = null;

export function rebuildBox(params) {
  if (boxGroup) {
    scene.remove(boxGroup);
    boxGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  boxGroup = generateBox(params);
  scene.add(boxGroup);
}

export function updateExplode(factor) {
  if (boxGroup) setExplodeFactor(boxGroup, factor);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredMesh = null;
const hoverInfo = document.getElementById('hover-info');

function onPointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
canvas.addEventListener('pointermove', onPointerMove);

function updateHover() {
  if (!boxGroup) return;

  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  boxGroup.traverse(c => { if (c.isMesh) meshes.push(c); });
  const hits = raycaster.intersectObjects(meshes, false);

  if (hits.length > 0) {
    const mesh = hits[0].object;
    if (mesh !== hoveredMesh) {
      if (hoveredMesh) hoveredMesh.material.emissive.setHex(0x000000);
      hoveredMesh = mesh;
      hoveredMesh.material.emissive.setHex(0x333355);
      const info = mesh.userData;
      hoverInfo.textContent = `${info.panelName}  ${info.dimLabel}`;
      hoverInfo.classList.add('visible');
    }
  } else {
    if (hoveredMesh) {
      hoveredMesh.material.emissive.setHex(0x000000);
      hoveredMesh = null;
    }
    hoverInfo.classList.remove('visible');
  }
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function animate() {
  requestAnimationFrame(animate);
  resize();
  controls.update();
  updateHover();
  renderer.render(scene, camera);
}

initControls({ rebuildBox, updateExplode });
animate();
