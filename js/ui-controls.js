/**
 * Wire up UI controls to rebuild the box and update the exploded view.
 *
 * @param {{ rebuildBox: Function, updateExplode: Function }} callbacks
 */
export function initControls({ rebuildBox, updateExplode }) {
  const sliderLength    = document.getElementById('param-length');
  const sliderWidth     = document.getElementById('param-width');
  const sliderHeight    = document.getElementById('param-height');
  const sliderThickness = document.getElementById('param-thickness');
  const sliderExplode   = document.getElementById('param-explode');

  const valLength    = document.getElementById('val-length');
  const valWidth     = document.getElementById('val-width');
  const valHeight    = document.getElementById('val-height');
  const valThickness = document.getElementById('val-thickness');
  const valExplode   = document.getElementById('val-explode');

  const jointRadios  = document.querySelectorAll('input[name="joint-type"]');
  const btnToggle    = document.getElementById('btn-toggle-explode');

  function getParams() {
    return {
      length:    parseFloat(sliderLength.value),
      width:     parseFloat(sliderWidth.value),
      height:    parseFloat(sliderHeight.value),
      thickness: parseFloat(sliderThickness.value),
      jointType: document.querySelector('input[name="joint-type"]:checked').value,
    };
  }

  function syncLabels() {
    valLength.textContent    = sliderLength.value;
    valWidth.textContent     = sliderWidth.value;
    valHeight.textContent    = sliderHeight.value;
    valThickness.textContent = sliderThickness.value;
    valExplode.textContent   = parseFloat(sliderExplode.value).toFixed(2);
  }

  function rebuild() {
    syncLabels();
    rebuildBox(getParams());
    updateExplode(parseFloat(sliderExplode.value));
  }

  // Dimension sliders
  for (const slider of [sliderLength, sliderWidth, sliderHeight, sliderThickness]) {
    slider.addEventListener('input', rebuild);
  }

  // Joint type radio
  for (const radio of jointRadios) {
    radio.addEventListener('change', rebuild);
  }

  // Explode slider
  sliderExplode.addEventListener('input', () => {
    syncLabels();
    updateExplode(parseFloat(sliderExplode.value));
  });

  // Toggle explode/assemble button with smooth animation
  let animating = false;
  btnToggle.addEventListener('click', () => {
    if (animating) return;
    animating = true;

    const current = parseFloat(sliderExplode.value);
    const target = current < 0.5 ? 1 : 0;
    const start = performance.now();
    const duration = 600;

    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const val = current + (target - current) * eased;
      sliderExplode.value = val;
      valExplode.textContent = val.toFixed(2);
      updateExplode(val);

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        animating = false;
      }
    }

    requestAnimationFrame(tick);
  });

  // Initial build
  rebuild();
}
