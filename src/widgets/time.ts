import type { WidgetSpec } from '../lib/types'
import { dedent, esc, repeat } from '../lib/util'

export const clock: WidgetSpec = {
  id: 'clock',
  name: 'Analog Clock',
  category: 'time',
  blurb: 'A real time dial with hour, minute and sweeping second hands.',
  tags: ['clock', 'time', 'dial'],
  frame: { w: 260, h: 260 },
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 200, min: 120, max: 260, step: 4, unit: 'px' },
    { key: 'face', label: 'Face', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'hand', label: 'Hands', type: 'color', default: '#f2f2f2', group: 'Color' },
    { key: 'accent', label: 'Second hand', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'ticks', label: 'Hour ticks', type: 'boolean', default: true },
    { key: 'smooth', label: 'Sweeping second', type: 'boolean', default: true },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-face': String(p.face),
    '--wg-hand': String(p.hand),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => dedent(`
    <div class="wg-clock__dial">
      ${p.ticks ? repeat(12, (i) => `<i class="wg-clock__tick" style="--i:${i}"></i>`) : ''}
      <i class="wg-clock__hand wg-clock__hand--hour" data-hand="hour"></i>
      <i class="wg-clock__hand wg-clock__hand--minute" data-hand="minute"></i>
      <i class="wg-clock__hand wg-clock__hand--second" data-hand="second"></i>
      <i class="wg-clock__pin"></i>
    </div>
  `),
  css: () => dedent(`
    .wg-clock {
      width: var(--wg-size);
      height: var(--wg-size);
    }
    .wg-clock__dial {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--wg-face);
      overflow: hidden;
    }
    .wg-clock__tick {
      position: absolute;
      left: 50%;
      top: 6%;
      width: 2px;
      height: 7%;
      margin-left: -1px;
      border-radius: 2px;
      background: var(--wg-hand);
      opacity: .55;
      transform-origin: 50% calc(var(--wg-size) / 2 - 6%);
      transform: rotate(calc(var(--i) * 30deg));
    }
    .wg-clock__tick:nth-child(3n + 1) { opacity: 1; height: 9%; width: 3px; margin-left: -1.5px; }
    .wg-clock__hand {
      position: absolute;
      left: 50%;
      bottom: 50%;
      border-radius: 99px;
      background: var(--wg-hand);
      transform-origin: 50% 100%;
      transform: translateX(-50%) rotate(var(--wg-rot, 0deg));
    }
    .wg-clock__hand--hour { width: 5px; height: 27%; }
    .wg-clock__hand--minute { width: 4px; height: 38%; }
    .wg-clock__hand--second {
      width: 2px;
      height: 42%;
      background: var(--wg-accent);
      bottom: calc(50% - 14%);
      height: 56%;
      transform-origin: 50% 75%;
    }
    .wg-clock__pin {
      position: absolute;
      inset: 50% auto auto 50%;
      width: 9px;
      height: 9px;
      margin: -4.5px 0 0 -4.5px;
      border-radius: 50%;
      background: var(--wg-hand);
    }
  `),
  script: (p) => dedent(`
    var smooth = ${p.smooth ? 'true' : 'false'};
    var hands = {
      hour: root.querySelector('[data-hand="hour"]'),
      minute: root.querySelector('[data-hand="minute"]'),
      second: root.querySelector('[data-hand="second"]')
    };
    function tick() {
      var d = new Date();
      var s = d.getSeconds() + (smooth ? d.getMilliseconds() / 1000 : 0);
      var m = d.getMinutes() + s / 60;
      var h = (d.getHours() % 12) + m / 60;
      hands.hour.style.setProperty('--wg-rot', (h * 30) + 'deg');
      hands.minute.style.setProperty('--wg-rot', (m * 6) + 'deg');
      hands.second.style.setProperty('--wg-rot', (s * 6) + 'deg');
    }
    var frame = 0, timer = 0;
    if (smooth) {
      var loop = function () { tick(); frame = requestAnimationFrame(loop); };
      loop();
    } else {
      tick();
      timer = setInterval(tick, 1000);
    }
    return function () { cancelAnimationFrame(frame); clearInterval(timer); };
  `),
}

export const agenda: WidgetSpec = {
  id: 'agenda',
  name: 'Day Agenda',
  category: 'time',
  blurb: 'A day column with stacked events and a live now marker.',
  tags: ['calendar', 'schedule', 'events'],
  frame: { w: 420, h: 190 },
  controls: [
    { key: 'weekday', label: 'Weekday', type: 'text', default: 'Tuesday', maxLength: 12 },
    { key: 'day', label: 'Day number', type: 'text', default: '22', maxLength: 2 },
    { key: 'title1', label: 'Event 1', type: 'text', default: 'Deep Focus Session', group: 'Events' },
    { key: 'time1', label: 'Time 1', type: 'text', default: '9:00 AM - 11:00 AM', group: 'Events' },
    { key: 'title2', label: 'Event 2', type: 'text', default: 'Client Sync: Feedback', group: 'Events' },
    { key: 'time2', label: 'Time 2', type: 'text', default: '12:30 PM - 1:15 PM', group: 'Events' },
    { key: 'total', label: 'Event count', type: 'number', default: 5, min: 1, max: 24, step: 1 },
    { key: 'bg', label: 'Card', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#111111', group: 'Color' },
    { key: 'row', label: 'Event row', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'accent', label: 'Now marker', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'sweep', label: 'Animate now marker', type: 'boolean', default: true },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-row': String(p.row),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => dedent(`
    <div class="wg-agenda__day">
      <span class="wg-agenda__weekday">${esc(String(p.weekday))}</span>
      <strong class="wg-agenda__date">${esc(String(p.day))}</strong>
      <span class="wg-agenda__count">${Number(p.total)} Events</span>
    </div>
    <div class="wg-agenda__list">
      <div class="wg-agenda__event">
        <span class="wg-agenda__title">${esc(String(p.title1))}</span>
        <span class="wg-agenda__time">${esc(String(p.time1))}</span>
      </div>
      <div class="wg-agenda__event">
        <span class="wg-agenda__title">${esc(String(p.title2))}</span>
        <span class="wg-agenda__time">${esc(String(p.time2))}</span>
      </div>
      <div class="wg-agenda__now${p.sweep ? ' is-live' : ''}"><i></i></div>
    </div>
  `),
  css: () => dedent(`
    .wg-agenda {
      display: flex;
      gap: 18px;
      align-items: stretch;
      width: 420px;
      padding: 20px;
      border-radius: 24px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-agenda__day {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 74px;
    }
    .wg-agenda__weekday { opacity: .55; }
    .wg-agenda__date { font-size: 34px; font-weight: 600; letter-spacing: -.02em; }
    .wg-agenda__count { font-size: 12px; opacity: .55; }
    .wg-agenda__list { position: relative; flex: 1; display: flex; flex-direction: column; gap: 10px; }
    .wg-agenda__event {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--wg-row);
      color: #fff;
    }
    .wg-agenda__title { font-weight: 600; font-size: 13px; }
    .wg-agenda__time { font-size: 11px; opacity: .6; }
    .wg-agenda__now {
      position: absolute;
      left: -14px;
      right: -14px;
      top: 34%;
      height: 1px;
      background: var(--wg-accent);
      pointer-events: none;
    }
    .wg-agenda__now i {
      position: absolute;
      left: 0;
      top: -3px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--wg-accent);
    }
    .wg-agenda__now.is-live { animation: wg-agenda-sweep 6s ease-in-out infinite; }
    @keyframes wg-agenda-sweep {
      0%, 100% { top: 26%; }
      50% { top: 46%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-agenda__now.is-live { animation: none; }
    }
  `),
}

const MS_DAY = 86400000

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n
}

/** Remaining milliseconds until an ISO datetime string, clamped at zero (never negative). */
export function remainingMs(targetDate: string): number {
  const t = new Date(targetDate).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, t - Date.now())
}

/** Day/hour/minute/second decomposition of a remaining duration, plus the expiry state. */
export interface Countdown {
  /** input milliseconds clamped at zero — the countdown never runs negative (M-3) */
  ms: number
  /** true once the target is reached or passed */
  expired: boolean
  days: number
  hours: number
  mins: number
  secs: number
  /** D-day tag: `D-n` while counting down, `D-DAY` once expired */
  dday: string
}

/**
 * Pure decomposition of `ms` remaining into day/hour/minute/second units (M-2) with a
 * zero floor so a passed target reads as an expired, all-zero state rather than negative
 * time (M-3). Shared by `markup` here and mirrored by the browser `script` tick engine.
 */
export function breakdown(ms: number): Countdown {
  const clamped = Math.max(0, Number.isFinite(ms) ? ms : 0)
  const expired = clamped <= 0
  const total = Math.floor(clamped / 1000)
  return {
    ms: clamped,
    expired,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    mins: Math.floor((total % 3600) / 60),
    secs: total % 60,
    dday: expired ? 'D-DAY' : 'D-' + Math.ceil(clamped / MS_DAY),
  }
}

export const countdown: WidgetSpec = {
  id: 'countdown',
  name: 'Event Countdown',
  category: 'time',
  blurb: 'A live countdown to a target date, as a unit breakdown or a D-day tag.',
  tags: ['time', 'countdown', 'event'],
  frame: { w: 260, h: 260 },
  controls: [
    { key: 'targetDate', label: 'Target date', type: 'datetime', default: '2026-12-31T23:59' },
    { key: 'label', label: 'Label', type: 'text', default: 'Sale ends in', maxLength: 40 },
    {
      key: 'displayMode',
      label: 'Display',
      type: 'select',
      default: 'breakdown',
      options: [
        { value: 'breakdown', label: 'Breakdown' },
        { value: 'dday', label: 'D-day' },
      ],
    },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#f2f2f2', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#ff3b5c', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => {
    const b = breakdown(remainingMs(String(p.targetDate)))
    const label = String(p.label ?? '').trim()
    const labelHtml = label ? `<div class="wg-countdown__label">${esc(label)}</div>` : ''
    const mode = String(p.displayMode) === 'dday' ? 'dday' : 'breakdown'
    const expiredClass = b.expired ? ' is-expired' : ''
    const body =
      mode === 'dday'
        ? `<div class="wg-countdown__dday${expiredClass}" data-dday>${esc(b.dday)}</div>`
        : dedent(`
            <div class="wg-countdown__grid${expiredClass}">
              <div class="wg-countdown__cell"><span class="wg-countdown__num" data-unit="days">${b.days}</span><span class="wg-countdown__unit">Days</span></div>
              <div class="wg-countdown__cell"><span class="wg-countdown__num" data-unit="hours">${pad2(b.hours)}</span><span class="wg-countdown__unit">Hrs</span></div>
              <div class="wg-countdown__cell"><span class="wg-countdown__num" data-unit="minutes">${pad2(b.mins)}</span><span class="wg-countdown__unit">Min</span></div>
              <div class="wg-countdown__cell wg-countdown__cell--accent"><span class="wg-countdown__num" data-unit="seconds">${pad2(b.secs)}</span><span class="wg-countdown__unit">Sec</span></div>
            </div>
            <div class="wg-countdown__ended">Ended</div>
          `)
    return dedent(`
      ${labelHtml}
      ${body}
    `)
  },
  css: () => dedent(`
    .wg-countdown {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      width: 260px;
      height: 260px;
      padding: 24px;
      box-sizing: border-box;
      border-radius: 28px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 600 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: center;
    }
    .wg-countdown__label {
      font-size: 12px;
      font-weight: 500;
      letter-spacing: .08em;
      text-transform: uppercase;
      opacity: .6;
    }
    .wg-countdown__grid {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .wg-countdown__cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-width: 46px;
    }
    .wg-countdown__num {
      font-size: 34px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -.02em;
      font-variant-numeric: tabular-nums;
    }
    .wg-countdown__cell--accent .wg-countdown__num { color: var(--wg-accent); }
    .wg-countdown__unit {
      font-size: 10px;
      font-weight: 500;
      letter-spacing: .08em;
      text-transform: uppercase;
      opacity: .55;
    }
    .wg-countdown__dday {
      font-size: 60px;
      font-weight: 700;
      letter-spacing: -.03em;
      line-height: 1;
      color: var(--wg-accent);
      font-variant-numeric: tabular-nums;
    }
    .wg-countdown__ended {
      display: none;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--wg-accent);
    }
    .wg-countdown__grid.is-expired + .wg-countdown__ended { display: block; }
    .wg-countdown__grid.is-expired .wg-countdown__num { color: var(--wg-accent); opacity: .7; }
  `),
  script: (p) => {
    const t = new Date(String(p.targetDate)).getTime()
    const mode = String(p.displayMode) === 'dday' ? 'dday' : 'breakdown'
    return dedent(`
      var target = ${Number.isNaN(t) ? 'NaN' : t};
      var mode = '${mode}';
      var grid = root.querySelector('.wg-countdown__grid');
      var dday = root.querySelector('[data-dday]');
      var units = {
        days: root.querySelector('[data-unit="days"]'),
        hours: root.querySelector('[data-unit="hours"]'),
        minutes: root.querySelector('[data-unit="minutes"]'),
        seconds: root.querySelector('[data-unit="seconds"]')
      };
      function pad2(n) { return (n < 10 ? '0' : '') + n; }
      function tick() {
        var ms = isNaN(target) ? 0 : target - Date.now();
        var expired = ms <= 0;
        if (expired) ms = 0;
        if (mode === 'dday') {
          if (dday) {
            dday.textContent = expired ? 'D-DAY' : 'D-' + Math.ceil(ms / 86400000);
            dday.classList.toggle('is-expired', expired);
          }
          return;
        }
        if (grid) grid.classList.toggle('is-expired', expired);
        var total = Math.floor(ms / 1000);
        var days = Math.floor(total / 86400);
        var hours = Math.floor((total % 86400) / 3600);
        var mins = Math.floor((total % 3600) / 60);
        var secs = total % 60;
        if (units.days) units.days.textContent = String(days);
        if (units.hours) units.hours.textContent = pad2(hours);
        if (units.minutes) units.minutes.textContent = pad2(mins);
        if (units.seconds) units.seconds.textContent = pad2(secs);
      }
      tick();
      var timer = setInterval(tick, 1000);
      return function () { clearInterval(timer); };
    `)
  },
}
