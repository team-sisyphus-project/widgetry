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
 * Pomodoro timer. The phase in effect is carried by colour (a persistent accent
 * swap) and the handover moment by a single ring pulse — `recordbutton`'s ping
 * keyframe retargeted from an infinite "armed" loop to a one-shot event marker,
 * because a ring pulsing for a whole 25 minute focus round would be noise.
 *
 * Markup renders the opening state: focus round one, full duration on the clock,
 * nothing on the round track yet. `script` takes it from there, driving the state
 * classes below (`is-break`, `is-done`, `is-ready`, `is-signal`) and the mm:ss
 * readout off one deadline per phase:
 *
 *     deadline  = phaseStart + (workMinutes | breakMinutes) * 60000
 *     remaining = max(0, deadline - Date.now())   // recomputed every 1s tick
 *
 * The remaining time is derived from the clock rather than decremented, so a
 * late or throttled interval changes when a frame is drawn, never what it says,
 * and nothing banks an error across a handover. That is the ±1s bar of M-3,
 * held under jittered ticks and off-grid sampling in `focus-timer.tick.test.ts`.
 */
export const focusTimer: WidgetSpec = {
  id: 'focus-timer',
  name: 'Focus Timer',
  category: 'system',
  blurb: 'A Pomodoro timer that alternates focus and break rounds with the time left in view.',
  tags: ['system', 'timer', 'pomodoro', 'focus'],
  frame: { w: 220, h: 200 },
  interactive: true,
  controls: [
    { key: 'workMinutes', label: 'Focus', type: 'number', default: 25, min: 1, max: 90, step: 1, unit: 'min' },
    { key: 'breakMinutes', label: 'Break', type: 'number', default: 5, min: 1, max: 30, step: 1, unit: 'min' },
    { key: 'rounds', label: 'Rounds', type: 'number', default: 4, min: 1, max: 12, step: 1 },
    { key: 'autoStart', label: 'Auto start next phase', type: 'boolean', default: true },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Focus accent', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'breakAccent', label: 'Break accent', type: 'color', default: '#3ef07d', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
    '--wg-break-accent': String(p.breakAccent),
  }),
  markup: (p) => {
    const rounds = Math.max(1, Math.round(Number(p.rounds)))
    const work = Math.max(1, Math.round(Number(p.workMinutes)))
    const clock = `${work < 10 ? '0' : ''}${work}:00`
    // autoStart governs phase handover only, so round one is always live on mount;
    // the advance control exists solely for the hold state and stays hidden until then.
    const advance = p.autoStart
      ? ''
      : '<button class="wg-focus-timer__advance" type="button" data-advance>Start next phase</button>'
    return dedent(`
      <div class="wg-focus-timer__card is-work" data-card role="timer" aria-label="Focus timer">
        <div class="wg-focus-timer__head">
          <span class="wg-focus-timer__phase" data-phase>FOCUS</span>
          <span class="wg-focus-timer__round" data-round>1 / ${rounds}</span>
        </div>
        <div class="wg-focus-timer__meter">
          <strong class="wg-focus-timer__time" data-time>${clock}</strong>
          <span class="wg-focus-timer__ring" data-ring aria-hidden="true"></span>
        </div>
        <div class="wg-focus-timer__track" data-track role="img" aria-label="0 of ${rounds} focus rounds complete">
          ${repeat(rounds, (i) => `<i class="wg-focus-timer__mark" data-mark="${i}"></i>`)}
        </div>
        ${advance}
      </div>
    `).replace(/\n\s*\n/g, '\n')
  },
  css: () => dedent(`
    .wg-focus-timer { width: 200px; }
    .wg-focus-timer__card {
      --wg-phase: var(--wg-accent);
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      padding: 20px;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 12px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-focus-timer__card.is-break { --wg-phase: var(--wg-break-accent); }
    .wg-focus-timer__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      font-size: 10px;
    }
    .wg-focus-timer__phase {
      font-weight: 600;
      letter-spacing: .16em;
      color: var(--wg-phase);
      transition: color .25s ease;
    }
    .wg-focus-timer__round { opacity: .5; font-variant-numeric: tabular-nums; }
    .wg-focus-timer__meter { position: relative; display: flex; }
    .wg-focus-timer__time {
      font-size: 34px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: -.02em;
      font-variant-numeric: tabular-nums;
      color: var(--wg-phase);
      transition: color .25s ease, opacity .25s ease;
    }
    .wg-focus-timer__ring {
      position: absolute;
      inset: -10px -16px;
      border: 2px solid var(--wg-phase);
      border-radius: 999px;
      opacity: 0;
      pointer-events: none;
    }
    .wg-focus-timer__card.is-signal .wg-focus-timer__ring {
      animation: wg-focus-timer-ping 1.6s ease-out 1;
    }
    .wg-focus-timer__track { display: flex; gap: 6px; }
    .wg-focus-timer__mark {
      flex: 1;
      height: 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      transition: background .25s ease;
    }
    .wg-focus-timer__mark.is-done { background: var(--wg-phase); }
    .wg-focus-timer__card.is-ready .wg-focus-timer__time { opacity: .45; }
    .wg-focus-timer__card.is-done { --wg-phase: var(--wg-accent); }
    .wg-focus-timer__card.is-done .wg-focus-timer__phase,
    .wg-focus-timer__card.is-done .wg-focus-timer__time { opacity: .55; }
    .wg-focus-timer__advance {
      display: none;
      padding: 10px 16px;
      border: 0;
      border-radius: 999px;
      background: var(--wg-phase);
      color: var(--wg-bg);
      font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      letter-spacing: .08em;
      cursor: pointer;
    }
    .wg-focus-timer__card.is-ready .wg-focus-timer__advance { display: block; }
    @keyframes wg-focus-timer-ping {
      0% { transform: scale(1); opacity: .8; }
      100% { transform: scale(1.22); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-focus-timer__card.is-signal .wg-focus-timer__ring { animation: none; }
      .wg-focus-timer__phase,
      .wg-focus-timer__time,
      .wg-focus-timer__mark { transition: none; }
    }
  `),
  script: (p) => {
    const work = Math.max(1, Math.round(Number(p.workMinutes))) * 60000
    const rest = Math.max(1, Math.round(Number(p.breakMinutes))) * 60000
    const rounds = Math.max(1, Math.round(Number(p.rounds)))
    return dedent(`
      var WORK = ${work}, BREAK = ${rest}, ROUNDS = ${rounds};
      var AUTO = ${p.autoStart ? 'true' : 'false'};
      // Phases are addressed by one index instead of a queue: even is a focus
      // round, odd is the break that follows it. The trailing break is dropped,
      // so LAST is the final focus round and anything past it is the terminal
      // done state.
      var LAST = ROUNDS * 2 - 2;
      var SIGNAL_MS = 1600;

      var card = root.querySelector('[data-card]');
      var phaseEl = root.querySelector('[data-phase]');
      var timeEl = root.querySelector('[data-time]');
      var roundEl = root.querySelector('[data-round]');
      var trackEl = root.querySelector('[data-track]');
      var marks = root.querySelectorAll('[data-mark]');
      var advance = root.querySelector('[data-advance]');

      var at = 0;          // index into the phase sequence
      var deadline = 0;    // absolute ms the running phase ends at
      var holding = false; // parked on a handover, waiting for the advance click
      var timer = 0, signal = 0;

      function isWork(i) { return i % 2 === 0; }
      function roundOf(i) { return Math.floor(i / 2) + 1; }
      function lengthOf(i) { return isWork(i) ? WORK : BREAK; }
      /** Focus rounds finished so far; a break counts the round it follows. */
      function finished() {
        if (at > LAST) return ROUNDS;
        return isWork(at) ? roundOf(at) - 1 : roundOf(at);
      }
      function pad2(n) { return (n < 10 ? '0' : '') + n; }
      function clock(ms) {
        var total = Math.max(0, Math.floor(ms / 1000));
        return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
      }

      function render(ms) {
        var over = at > LAST;
        var label = over ? 'DONE' : isWork(at) ? 'FOCUS' : 'BREAK';
        phaseEl.textContent = holding ? label + ' \\u00b7 READY' : label;
        timeEl.textContent = clock(ms);
        roundEl.textContent = (over ? ROUNDS : roundOf(at)) + ' / ' + ROUNDS;
        var done = finished();
        for (var i = 0; i < marks.length; i++) marks[i].classList.toggle('is-done', i < done);
        if (trackEl) {
          trackEl.setAttribute('aria-label', done + ' of ' + ROUNDS + ' focus rounds complete');
        }
        card.classList.toggle('is-work', !over && isWork(at));
        card.classList.toggle('is-break', !over && !isWork(at));
        card.classList.toggle('is-ready', holding);
        card.classList.toggle('is-done', over);
      }

      // One-shot ring pulse. Removing the class and reading back a layout value
      // restarts the animation, so a second handover re-fires it.
      function pulse() {
        card.classList.remove('is-signal');
        void card.offsetWidth;
        card.classList.add('is-signal');
        clearTimeout(signal);
        signal = setTimeout(function () { card.classList.remove('is-signal'); }, SIGNAL_MS);
      }

      function begin(from) {
        holding = false;
        deadline = from + lengthOf(at);
        render(deadline - Date.now());
      }

      function finish() {
        clearInterval(timer);
        timer = 0;
        holding = false;
        pulse();
        render(0);
      }

      function tick() {
        if (holding) return;
        var ms = deadline - Date.now();
        // Anchored on the deadline, not on an accumulated -1s, so interval
        // jitter moves when a frame is drawn and never what it says. The loop
        // also catches up when several phases elapsed while throttled.
        while (ms <= 0) {
          at++;
          if (at > LAST) { finish(); return; }
          pulse();
          if (!AUTO) { holding = true; render(lengthOf(at)); return; }
          deadline += lengthOf(at);
          ms = deadline - Date.now();
        }
        render(ms);
      }

      function onAdvance() {
        if (holding) begin(Date.now());
      }

      // autoStart governs handover only: round one runs on mount either way.
      begin(Date.now());
      if (advance) advance.addEventListener('click', onAdvance);
      timer = setInterval(tick, 1000);
      return function () {
        clearInterval(timer);
        clearTimeout(signal);
        if (advance) advance.removeEventListener('click', onAdvance);
      };
    `)
  },
}
