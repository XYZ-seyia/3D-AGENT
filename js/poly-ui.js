/**
 * UI controls for the polyhedra generator.
 * Connects DOM elements to poly-main state.
 */
import { setParam, setExplode, rebuild, getParams } from './poly-main.js';

export function initUI() {
  const solidTypeEl = document.getElementById('solidType');
  const edgeLengthEl = document.getElementById('edgeLength');
  const thicknessEl = document.getElementById('thickness');
  const explodeEl = document.getElementById('explode');
  const explodeBtn = document.getElementById('explodeBtn');
  const edgeLenVal = document.getElementById('edgeLenVal');
  const thicknessVal = document.getElementById('thicknessVal');

  solidTypeEl.addEventListener('change', () => {
    setParam('solidType', solidTypeEl.value);
  });

  edgeLengthEl.addEventListener('input', () => {
    edgeLenVal.textContent = edgeLengthEl.value;
    setParam('edgeLength', Number(edgeLengthEl.value));
  });

  thicknessEl.addEventListener('input', () => {
    thicknessVal.textContent = thicknessEl.value;
    setParam('thickness', Number(thicknessEl.value));
  });

  explodeEl.addEventListener('input', () => {
    setExplode(Number(explodeEl.value));
  });

  let exploded = false;
  let animId = null;

  explodeBtn.addEventListener('click', () => {
    exploded = !exploded;
    explodeBtn.textContent = exploded ? '合拢' : '展开';
    const target = exploded ? 1 : 0;
    const start = Number(explodeEl.value);
    const startTime = performance.now();
    const duration = 600;

    if (animId) cancelAnimationFrame(animId);

    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const val = start + (target - start) * eased;
      explodeEl.value = val;
      setExplode(val);
      if (t < 1) animId = requestAnimationFrame(step);
    }

    animId = requestAnimationFrame(step);
  });
}
