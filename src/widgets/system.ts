import type { WidgetSpec } from '../lib/types'
import { dedent, esc, repeat } from '../lib/util'

export const battery: WidgetSpec = {
  id: 'battery',
  name: 'Charge Meter',
  category: 'system',
  blurb: 'Segmented charge level that fills in sequence while charging.',
  tags: ['battery', 'power', 'meter'],
  frame: { w: 210, h: 190 },
  controls: [
    { key: 'label', label: 'Label', type: 'text', default: 'CHARGING' },
    { key: 'level', label: 'Level', type: 'number', default: 25, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'segments', label: 'Segments', type: 'number', default: 6, min: 3, max: 12, step: 1 },
    { key: 'charging', label: 'Charging animation', type: 'boolean', default: true },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'fill', label: 'Charge', type: 'color', default: '#3ef07d', group: 'Color' },
    { key: 'empty', label: 'Empty slot', type: 'color', default: '#2a2f2c', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-fill': String(p.fill),
    '--wg-empty': String(p.empty),
  }),
  markup: (p) => {
    const n = Number(p.segments)
    const on = Math.round((Number(p.level) / 100) * n)
    return dedent(`
      <span class="wg-battery__label">${esc(String(p.label))}</span>
      <strong class="wg-battery__value">${Number(p.level)}%</strong>
      <div class="wg-battery__bar">
        ${repeat(n, (i) => `<i class="wg-battery__cell${i < on ? ' is-on' : ''}${p.charging && i < on ? ' is-pulse' : ''}" style="--i:${i}"></i>`)}
      </div>
    `)
  },
  css: () => dedent(`
    .wg-battery {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 190px;
      padding: 20px;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-battery__label { font-size: 10px; letter-spacing: .16em; opacity: .5; }
    .wg-battery__value { font-size: 32px; font-weight: 600; letter-spacing: -.02em; }
    .wg-battery__bar { display: flex; gap: 6px; margin-top: 12px; }
    .wg-battery__cell {
      flex: 1;
      height: 40px;
      border-radius: 6px;
      background: var(--wg-empty);
      transition: background .3s ease;
    }
    .wg-battery__cell.is-on { background: var(--wg-fill); }
    .wg-battery__cell.is-pulse {
      animation: wg-battery-pulse 2.2s ease-in-out infinite;
      animation-delay: calc(var(--i) * .14s);
    }
    @keyframes wg-battery-pulse {
      0%, 60%, 100% { opacity: 1; }
      30% { opacity: .35; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-battery__cell.is-pulse { animation: none; }
    }
  `),
}

export const brightness: WidgetSpec = {
  id: 'brightness',
  name: 'Brightness Pill',
  category: 'system',
  blurb: 'A drag anywhere vertical slider with a live percentage readout.',
  tags: ['slider', 'control', 'brightness'],
  frame: { w: 140, h: 240 },
  interactive: true,
  controls: [
    { key: 'value', label: 'Value', type: 'number', default: 62, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'width', label: 'Width', type: 'number', default: 84, min: 56, max: 130, step: 2, unit: 'px' },
    { key: 'height', label: 'Height', type: 'number', default: 190, min: 120, max: 260, step: 2, unit: 'px' },
    { key: 'showValue', label: 'Show value', type: 'boolean', default: false },
    { key: 'track', label: 'Track', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'fill', label: 'Fill', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'icon', label: 'Icon', type: 'color', default: '#0a0a0a', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-w': `${p.width}px`,
    '--wg-h': `${p.height}px`,
    '--wg-track': String(p.track),
    '--wg-fill': String(p.fill),
    '--wg-icon': String(p.icon),
    '--wg-v': `${p.value}%`,
  }),
  markup: (p) => dedent(`
    <div class="wg-brightness__track" data-track role="slider" tabindex="0"
         aria-label="Brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(p.value)}">
      <div class="wg-brightness__fill" data-fill></div>
      <svg class="wg-brightness__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="currentColor"></circle>
        <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 2.6v2.4"></path><path d="M12 19v2.4"></path>
          <path d="M2.6 12h2.4"></path><path d="M19 12h2.4"></path>
          <path d="M5.4 5.4l1.7 1.7"></path><path d="M16.9 16.9l1.7 1.7"></path>
          <path d="M18.6 5.4l-1.7 1.7"></path><path d="M7.1 16.9l-1.7 1.7"></path>
        </g>
      </svg>
      ${p.showValue ? '<span class="wg-brightness__value" data-value>' + Number(p.value) + '</span>' : ''}
    </div>
  `),
  css: () => dedent(`
    .wg-brightness { width: var(--wg-w); height: var(--wg-h); }
    .wg-brightness__track {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 999px;
      background: var(--wg-track);
      overflow: hidden;
      cursor: ns-resize;
      touch-action: none;
      outline: none;
    }
    .wg-brightness__track:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--wg-fill) 60%, transparent); }
    .wg-brightness__fill {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: var(--wg-v);
      background: var(--wg-fill);
      transition: height .12s ease-out;
    }
    .wg-brightness__icon {
      position: absolute;
      left: 50%;
      top: 16px;
      width: 26px;
      height: 26px;
      margin-left: -13px;
      color: var(--wg-icon);
      mix-blend-mode: difference;
      filter: invert(1);
    }
    .wg-brightness__value {
      position: absolute;
      left: 0; right: 0; bottom: 14px;
      text-align: center;
      font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
      color: var(--wg-icon);
      mix-blend-mode: difference;
      filter: invert(1);
    }
  `),
  script: () => dedent(`
    var track = root.querySelector('[data-track]');
    var readout = root.querySelector('[data-value]');
    var dragging = false;
    function set(v) {
      v = Math.max(0, Math.min(100, Math.round(v)));
      root.style.setProperty('--wg-v', v + '%');
      track.setAttribute('aria-valuenow', String(v));
      if (readout) readout.textContent = String(v);
      root.dispatchEvent(new CustomEvent('wg:change', { detail: { value: v }, bubbles: true }));
    }
    function fromEvent(e) {
      var r = track.getBoundingClientRect();
      set(((r.bottom - e.clientY) / r.height) * 100);
    }
    function down(e) { dragging = true; track.setPointerCapture(e.pointerId); fromEvent(e); }
    function move(e) { if (dragging) fromEvent(e); }
    function up() { dragging = false; }
    function key(e) {
      var cur = parseFloat(track.getAttribute('aria-valuenow')) || 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(cur + 5); e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(cur - 5); e.preventDefault(); }
    }
    track.addEventListener('pointerdown', down);
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    track.addEventListener('keydown', key);
    return function () {
      track.removeEventListener('pointerdown', down);
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
      track.removeEventListener('keydown', key);
    };
  `),
}

export const toggle: WidgetSpec = {
  id: 'toggle',
  name: 'Label Switch',
  category: 'system',
  blurb: 'A wide switch that keeps both state labels visible.',
  tags: ['switch', 'toggle', 'form'],
  frame: { w: 220, h: 110 },
  interactive: true,
  controls: [
    { key: 'on', label: 'On', type: 'boolean', default: false },
    { key: 'offLabel', label: 'Off label', type: 'text', default: 'OFF', maxLength: 8 },
    { key: 'onLabel', label: 'On label', type: 'text', default: 'ON', maxLength: 8 },
    { key: 'width', label: 'Width', type: 'number', default: 176, min: 120, max: 260, step: 4, unit: 'px' },
    { key: 'bg', label: 'Track', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'knob', label: 'Knob', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'knobOn', label: 'Knob when on', type: 'color', default: '#3ef07d', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-w': `${p.width}px`,
    '--wg-bg': String(p.bg),
    '--wg-knob': String(p.knob),
    '--wg-knob-on': String(p.knobOn),
    '--wg-ink': String(p.ink),
  }),
  markup: (p) => dedent(`
    <button class="wg-toggle__btn${p.on ? ' is-on' : ''}" type="button" data-toggle
            role="switch" aria-checked="${p.on ? 'true' : 'false'}">
      <span class="wg-toggle__knob" aria-hidden="true"></span>
      <span class="wg-toggle__label wg-toggle__label--off">${esc(String(p.offLabel))}</span>
      <span class="wg-toggle__label wg-toggle__label--on">${esc(String(p.onLabel))}</span>
    </button>
  `),
  css: () => dedent(`
    .wg-toggle { width: var(--wg-w); }
    .wg-toggle__btn {
      position: relative;
      display: block;
      width: 100%;
      height: calc(var(--wg-w) * .42);
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: var(--wg-bg);
      cursor: pointer;
      font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
      letter-spacing: .1em;
      color: var(--wg-ink);
    }
    .wg-toggle__knob {
      position: absolute;
      top: 6%;
      left: 1.6%;
      width: 48%;
      height: 88%;
      border-radius: 999px;
      background: var(--wg-knob);
      transition: transform .32s cubic-bezier(.4, 1.3, .5, 1), background .32s ease;
    }
    .wg-toggle__btn.is-on .wg-toggle__knob {
      transform: translateX(102%);
      background: var(--wg-knob-on);
    }
    .wg-toggle__label {
      position: absolute;
      top: 50%;
      width: 50%;
      transform: translateY(-50%);
      transition: color .32s ease, opacity .32s ease;
    }
    .wg-toggle__label--off { left: 0; color: #0a0a0a; }
    .wg-toggle__label--on { right: 0; opacity: .45; }
    .wg-toggle__btn.is-on .wg-toggle__label--off { color: var(--wg-ink); opacity: .45; }
    .wg-toggle__btn.is-on .wg-toggle__label--on { color: #0a0a0a; opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .wg-toggle__knob, .wg-toggle__label { transition: none; }
    }
  `),
  script: () => dedent(`
    var btn = root.querySelector('[data-toggle]');
    function flip() {
      var on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      root.dispatchEvent(new CustomEvent('wg:change', { detail: { on: on }, bubbles: true }));
    }
    btn.addEventListener('click', flip);
    return function () { btn.removeEventListener('click', flip); };
  `),
}

export const compass: WidgetSpec = {
  id: 'compass',
  name: 'Compass Dial',
  category: 'system',
  blurb: 'A cardinal dial with a needle that drifts like a real magnetometer.',
  tags: ['compass', 'dial', 'navigation'],
  frame: { w: 220, h: 220 },
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 180, min: 120, max: 240, step: 4, unit: 'px' },
    { key: 'heading', label: 'Heading', type: 'number', default: 18, min: 0, max: 359, step: 1, unit: 'deg' },
    { key: 'drift', label: 'Live drift', type: 'boolean', default: true },
    { key: 'face', label: 'Face', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'north', label: 'North', type: 'color', default: '#ff3b5c', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-face': String(p.face),
    '--wg-ink': String(p.ink),
    '--wg-north': String(p.north),
    '--wg-rot': `${p.heading}deg`,
  }),
  markup: () => dedent(`
    <div class="wg-compass__face">
      <span class="wg-compass__cardinal wg-compass__cardinal--n">N</span>
      <span class="wg-compass__cardinal wg-compass__cardinal--e">E</span>
      <span class="wg-compass__cardinal wg-compass__cardinal--s">S</span>
      <span class="wg-compass__cardinal wg-compass__cardinal--w">W</span>
      ${repeat(24, (i) => `<i class="wg-compass__tick" style="--i:${i}"></i>`)}
      <div class="wg-compass__rose" data-rose>
        <svg viewBox="0 0 40 40" class="wg-compass__needle" aria-hidden="true">
          <path d="M20 5 L27 20 L20 17 L13 20 Z" fill="currentColor"></path>
        </svg>
      </div>
      <div class="wg-compass__hub"><span></span></div>
    </div>
  `),
  css: () => dedent(`
    .wg-compass { width: var(--wg-size); height: var(--wg-size); }
    .wg-compass__face {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--wg-face);
      color: var(--wg-ink);
      font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    .wg-compass__cardinal { position: absolute; opacity: .8; }
    .wg-compass__cardinal--n { top: 9%; left: 50%; transform: translateX(-50%); color: var(--wg-north); }
    .wg-compass__cardinal--s { bottom: 9%; left: 50%; transform: translateX(-50%); }
    .wg-compass__cardinal--e { right: 9%; top: 50%; transform: translateY(-50%); }
    .wg-compass__cardinal--w { left: 9%; top: 50%; transform: translateY(-50%); }
    .wg-compass__tick {
      position: absolute;
      left: 50%;
      top: 3%;
      width: 1.5px;
      height: 5%;
      margin-left: -.75px;
      background: currentColor;
      opacity: .3;
      transform-origin: 50% calc(var(--wg-size) / 2 - 3%);
      transform: rotate(calc(var(--i) * 15deg));
    }
    .wg-compass__tick:nth-child(6n + 5) { opacity: .7; height: 7%; }
    .wg-compass__rose {
      position: absolute;
      inset: 0;
      transform: rotate(var(--wg-rot));
      transition: transform .6s cubic-bezier(.2, .8, .3, 1);
    }
    .wg-compass__needle {
      position: absolute;
      left: 50%;
      top: 22%;
      width: 34%;
      margin-left: -17%;
      color: var(--wg-ink);
    }
    .wg-compass__hub {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 26%;
      height: 26%;
      margin: -13% 0 0 -13%;
      border-radius: 50%;
      background: color-mix(in srgb, var(--wg-ink) 16%, transparent);
      display: grid;
      place-items: center;
    }
    .wg-compass__hub span {
      width: 34%;
      height: 2px;
      background: currentColor;
      opacity: .6;
      box-shadow: 0 0 0 0 transparent;
      position: relative;
    }
    .wg-compass__hub span::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 2px;
      height: 12px;
      margin: -6px 0 0 -1px;
      background: currentColor;
    }
  `),
  script: (p) => dedent(`
    ${p.drift ? '' : 'return function () {};'}
    var rose = root.querySelector('[data-rose]');
    var base = ${Number(p.heading)};
    var t = 0, frame = 0;
    function loop() {
      t += 0.01;
      var wobble = Math.sin(t) * 9 + Math.sin(t * 2.3) * 3.5;
      rose.style.transform = 'rotate(' + (base + wobble) + 'deg)';
      frame = requestAnimationFrame(loop);
    }
    rose.style.transition = 'none';
    loop();
    return function () { cancelAnimationFrame(frame); };
  `),
}

export const signal: WidgetSpec = {
  id: 'signal',
  name: 'Signal Orb',
  category: 'system',
  blurb: 'A round status chip whose bars breathe with connection strength.',
  tags: ['status', 'signal', 'icon'],
  frame: { w: 130, h: 130 },
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 86, min: 48, max: 130, step: 2, unit: 'px' },
    { key: 'bars', label: 'Bars', type: 'number', default: 4, min: 3, max: 6, step: 1 },
    { key: 'strength', label: 'Strength', type: 'number', default: 3, min: 0, max: 6, step: 1 },
    { key: 'animate', label: 'Animate', type: 'boolean', default: true },
    { key: 'bg', label: 'Background', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'on', label: 'Active bar', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'off', label: 'Idle bar', type: 'color', default: '#3a3a3a', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-bg': String(p.bg),
    '--wg-on': String(p.on),
    '--wg-off': String(p.off),
  }),
  markup: (p) => {
    const n = Number(p.bars)
    const s = Math.min(Number(p.strength), n)
    return dedent(`
      <div class="wg-signal__orb">
        <span class="wg-signal__bars" style="--n:${n}">
          ${repeat(n, (i) => `<i class="wg-signal__bar${i < s ? ' is-on' : ''}${p.animate ? ' is-live' : ''}" style="--i:${i}"></i>`)}
        </span>
      </div>
    `)
  },
  css: () => dedent(`
    .wg-signal { width: var(--wg-size); height: var(--wg-size); }
    .wg-signal__orb {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--wg-bg);
    }
    .wg-signal__bars {
      display: flex;
      align-items: flex-end;
      gap: 6%;
      width: 44%;
      height: 36%;
    }
    .wg-signal__bar {
      flex: 1;
      height: calc(32% + var(--i) * (68% / var(--n)));
      border-radius: 2px;
      background: var(--wg-off);
      transition: background .3s ease;
    }
    .wg-signal__bar.is-on { background: var(--wg-on); }
    .wg-signal__bar.is-live.is-on {
      animation: wg-signal-breathe 1.8s ease-in-out infinite;
      animation-delay: calc(var(--i) * .16s);
    }
    @keyframes wg-signal-breathe {
      0%, 100% { opacity: 1; }
      50% { opacity: .3; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-signal__bar.is-live.is-on { animation: none; }
    }
  `),
}

/**
 * Fill ratio for the thermometer gauge, clamped to [0, 1].
 * Same shape as the checklist / habit-streak progress rail: a single metric over its
 * goal, locked at 1 the moment the goal is reached so overshoot never overdraws the tube.
 */
function gaugeRatio(current: number, target: number): number {
  return Math.min(1, Math.max(0, current) / Math.max(1, target))
}

/** One decimal at most, so a shared URL carrying 72.4 still reads cleanly. */
function readable(n: number): string {
  return String(Math.round(n * 10) / 10)
}

export const thermometer: WidgetSpec = {
  id: 'thermometer',
  name: 'Thermometer',
  category: 'system',
  blurb: 'A vertical mercury gauge that climbs toward a target and turns over when it lands.',
  tags: ['thermometer', 'gauge', 'progress'],
  frame: { w: 220, h: 240 },
  controls: [
    { key: 'currentValue', label: 'Current value', type: 'number', default: 68, min: 0, max: 999, step: 1 },
    { key: 'targetValue', label: 'Target value', type: 'number', default: 100, min: 1, max: 999, step: 1 },
    { key: 'unit', label: 'Unit', type: 'text', default: '°F', maxLength: 6 },
    { key: 'steps', label: 'Scale steps', type: 'number', default: 4, min: 2, max: 8, step: 1 },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'mercury', label: 'Mercury', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'reached', label: 'At target', type: 'color', default: '#3ef07d', group: 'Color' },
    { key: 'empty', label: 'Tube', type: 'color', default: '#2a2f2c', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-mercury': String(p.mercury),
    '--wg-reached': String(p.reached),
    '--wg-empty': String(p.empty),
    '--wg-fill': `${gaugeRatio(Number(p.currentValue), Number(p.targetValue)) * 100}%`,
  }),
  markup: (p) => {
    const current = Math.max(0, Number(p.currentValue))
    const target = Math.max(1, Number(p.targetValue))
    const steps = Math.min(8, Math.max(2, Math.round(Number(p.steps))))
    const unit = String(p.unit).trim()
    const u = unit ? esc(unit) : ''
    const reached = current >= target
    const over = Math.max(0, current - target)
    /* The tube stops at the target, so the surplus is spoken instead of drawn. */
    const spoken =
      `${readable(current)}${unit} of ${readable(target)}${unit}` +
      (over > 0 ? `, ${readable(over)}${unit} over target` : reached ? ', target reached' : '')
    return dedent(`
      <div class="wg-thermometer__gauge${reached ? ' is-reached' : ''}" role="meter"
           aria-valuemin="0" aria-valuemax="${readable(target)}"
           aria-valuenow="${readable(Math.min(current, target))}" aria-valuetext="${esc(spoken)}">
        <div class="wg-thermometer__tube">
          <i class="wg-thermometer__mercury" data-mercury></i>
          ${repeat(steps - 1, (i) => {
            const y = Math.round(((i + 1) / steps) * 1000) / 10
            return `<i class="wg-thermometer__mark" style="--y:${y}%"></i>`
          })}
        </div>
        <span class="wg-thermometer__bulb" aria-hidden="true"></span>
      </div>
      <div class="wg-thermometer__read">
        <strong class="wg-thermometer__value" data-value>${readable(current)}${
          unit ? `<span class="wg-thermometer__unit">${u}</span>` : ''
        }</strong>
        <span class="wg-thermometer__target" data-target>of ${readable(target)}${u}</span>${
          over > 0
            ? `\n        <span class="wg-thermometer__over" data-over>+${readable(over)}${u} over</span>`
            : ''
        }
      </div>
    `)
  },
  css: () => dedent(`
    .wg-thermometer {
      display: flex;
      align-items: stretch;
      gap: 18px;
      width: 200px;
      height: 220px;
      padding: 20px;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-thermometer__gauge {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      align-items: center;
      width: 34px;
    }
    .wg-thermometer__tube {
      position: relative;
      flex: 1;
      width: 16px;
      margin-bottom: -10px;
      border-radius: 99px 99px 0 0;
      background: var(--wg-empty);
      overflow: hidden;
    }
    .wg-thermometer__mercury {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: var(--wg-fill);
      background: var(--wg-mercury);
      transition: height .35s cubic-bezier(.3, 1, .4, 1), background .3s ease;
    }
    .wg-thermometer__mark {
      position: absolute;
      right: 0;
      bottom: var(--y);
      width: 6px;
      height: 2px;
      background: var(--wg-ink);
      opacity: .35;
    }
    .wg-thermometer__bulb {
      position: relative;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--wg-mercury);
      transition: background .3s ease;
    }
    .wg-thermometer__gauge.is-reached .wg-thermometer__mercury,
    .wg-thermometer__gauge.is-reached .wg-thermometer__bulb { background: var(--wg-reached); }
    .wg-thermometer__read {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
      min-width: 0;
    }
    .wg-thermometer__value { font-size: 34px; font-weight: 600; letter-spacing: -.02em; line-height: 1; }
    .wg-thermometer__unit { font-size: 15px; font-weight: 500; margin-left: 2px; opacity: .7; }
    .wg-thermometer__gauge.is-reached ~ .wg-thermometer__read .wg-thermometer__value { color: var(--wg-reached); }
    .wg-thermometer__target { font-size: 12px; opacity: .55; }
    .wg-thermometer__over {
      align-self: flex-start;
      padding: 3px 8px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      font-size: 12px;
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-thermometer__mercury, .wg-thermometer__bulb { transition: none; }
    }
  `),
}
