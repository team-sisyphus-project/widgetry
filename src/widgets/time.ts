import type { Props, WidgetSpec } from '../lib/types'
import { clamp } from '../lib/types'
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
    // The sweeping second hand is a continuous animation, so it answers the same
    // reduced-motion policy every other animated widget here answers: under
    // \`prefers-reduced-motion: reduce\` the hand still keeps time, it just steps
    // once a second instead of running a frame loop.
    var reduce = false;
    try {
      reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reduce = false; }
    var smooth = ${p.smooth ? 'true' : 'false'} && !reduce;
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

/* ------------------------------------------------------------------ *
 * City board helpers — pure timezone arithmetic
 *
 * Shared by the city-clock board's `markup` and mirrored by its browser
 * `script`, the same way `breakdown` above is mirrored by the countdown's
 * tick engine. Everything here is a pure function of its arguments: no DOM,
 * no network, no ambient `Date.now()`.
 *
 * All zone knowledge comes from the rendering engine's own `Intl` data — no
 * bundled zone table, so there is nothing to keep up to date and nothing to
 * ship. The cost of that choice is that the set of valid zone ids is a
 * property of the machine running the code, not of the widget: an id the
 * author's browser accepts may be unknown to the taker's. Both entry points
 * below answer that case by refusing rather than guessing — `parseCities`
 * drops the entry and `zonedParts` returns `null`. Neither ever falls back
 * to the viewer's local time, because a face labelled "Berlin" quietly
 * showing Seoul's time is wrong in the one way nobody catches.
 * ------------------------------------------------------------------ */

/** Most cities one board will show. Entries past this are ignored. */
export const MAX_CITIES = 6

/** Separates entries inside the single delimited control value. */
const CITY_SEPARATOR = ','

/** Separates an entry's display label from its zone id. */
const LABEL_SEPARATOR = '|'

/** One face of a city board: a human label and the zone that drives its time. */
export interface City {
  /** display name shown with the face, e.g. `Berlin` */
  label: string
  /** IANA zone id this engine recognized, e.g. `Europe/Berlin` */
  zone: string
}

/** Wall-clock reading for one zone at one instant. */
export interface ZonedParts {
  /** the zone id this reading was resolved against */
  zone: string
  year: number
  /** 1-12 */
  month: number
  /** 1-31 */
  day: number
  /** 0-23 */
  hour: number
  minute: number
  second: number
  /** short weekday name in the zone, e.g. `Sun` */
  weekday: string
  /** minutes since local midnight, 0-1439 — the value working hours compare against */
  minutes: number
  /** offset from UTC in minutes at this instant, east positive; reflects DST */
  offsetMinutes: number
}

/**
 * Memoized zone probes. Constructing an `Intl.DateTimeFormat` is the only way to
 * ask whether a zone id exists, and it is expensive enough that six faces ticking
 * once a second should not repeat it. `null` records a zone this engine rejected,
 * so a bad id costs one `RangeError` for the life of the page rather than one per
 * tick.
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const key = typeof zone === 'string' ? zone.trim() : ''
  if (!key) return null
  const cached = zoneFormatters.get(key)
  if (cached !== undefined) return cached
  let fmt: Intl.DateTimeFormat | null = null
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      // `hourCycle` rather than `hour12: false` — the latter reports midnight as
      // hour 24 on some engines.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
  } catch {
    // RangeError: this engine's zone data has no such id. Remembered as unknown.
    fmt = null
  }
  zoneFormatters.set(key, fmt)
  return fmt
}

/** `Europe/Berlin` -> `Berlin`, `America/Argentina/Buenos_Aires` -> `Buenos Aires`. */
function labelFromZone(zone: string): string {
  const tail = zone.slice(zone.lastIndexOf('/') + 1)
  return tail.replace(/_/g, ' ')
}

/**
 * Parse the delimited city control into at most {@link MAX_CITIES} faces.
 *
 * Format is `Label|Zone` per entry, comma separated:
 * `'Berlin|Europe/Berlin, Seoul|Asia/Seoul'`. The label is optional — a bare
 * `Asia/Seoul` is read as that zone labelled `Seoul`, so a taker who types only
 * ids still gets readable faces.
 *
 * Entries naming a zone this engine does not recognize are dropped, and a dropped
 * entry does not consume one of the six slots: seven entries with one bad id still
 * yield six faces. Order is preserved.
 */
export function parseCities(s: string): City[] {
  const out: City[] = []
  if (typeof s !== 'string') return out
  for (const raw of s.split(CITY_SEPARATOR)) {
    const entry = raw.trim()
    if (!entry) continue
    const cut = entry.indexOf(LABEL_SEPARATOR)
    const label = cut < 0 ? '' : entry.slice(0, cut).trim()
    const zone = (cut < 0 ? entry : entry.slice(cut + 1)).trim()
    if (!formatterFor(zone)) continue
    out.push({ label: label || labelFromZone(zone), zone })
    if (out.length >= MAX_CITIES) break
  }
  return out
}

/**
 * Wall-clock reading for `zone` at `date`, straight from the engine's `Intl` data —
 * so DST transitions, half-hour offsets and historical rule changes are all handled
 * by the same table the platform uses, with no shipped zone table to drift.
 *
 * Returns `null` when the engine does not recognize `zone`, or when `date` is
 * invalid. `null` means "no reading", never "use local time": the caller renders an
 * explicit unavailable state, so a face is never labelled with one city while
 * showing another's time.
 */
export function zonedParts(zone: string, date: Date): ZonedParts | null {
  const fmt = formatterFor(zone)
  if (!fmt) return null
  const t = date instanceof Date ? date.getTime() : NaN
  if (!Number.isFinite(t)) return null

  const bag: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }

  const year = Number(bag.year)
  const month = Number(bag.month)
  const day = Number(bag.day)
  // `% 24` guards engines that still render midnight as hour 24.
  const hour = Number(bag.hour) % 24
  const minute = Number(bag.minute)
  const second = Number(bag.second)
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null

  // Reading the same instant twice — once as the zone's wall clock, once as the
  // true epoch — makes the offset fall out of the difference, DST included. Whole
  // minutes, so the sub-second remainder dropped by `Date.UTC` rounds away.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)

  return {
    zone: zone.trim(),
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: bag.weekday ?? '',
    minutes: hour * 60 + minute,
    offsetMinutes: Math.round((asUtc - t) / 60000),
  }
}

/** An hour-of-day bound as minutes since midnight; `24` is the end of the day. */
function boundMinutes(hour: number): number | null {
  if (!Number.isFinite(hour)) return null
  return Math.round(clamp(hour, 0, 24) * 60)
}

/**
 * Is the reading inside the working range `[start, end)`, in that city's own local
 * time? Bounds are hours; the start is included and the end is excluded, so a 9-18
 * range highlights 09:00 and 17:59 but not 08:59 or 18:00.
 *
 * When `end` is at or before `start` the range wraps midnight: 22-6 covers 22:00
 * through 05:59. The one exception is an empty range — `start` equal to `end` after
 * clamping — which matches nothing, the consistent reading of a half-open interval.
 * A whole day is written 0-24.
 *
 * A `null` reading (an unrecognized zone) is never working hours.
 */
export function isWorkingHour(parts: ZonedParts | null, start: number, end: number): boolean {
  if (!parts) return false
  const from = boundMinutes(start)
  const to = boundMinutes(end)
  if (from === null || to === null || from === to) return false
  const now = parts.minutes
  return from < to ? now >= from && now < to : now >= from || now < to
}

/* ------------------------------------------------------------------ *
 * World clock board
 * ------------------------------------------------------------------ */

/**
 * Analog dial diameter. Every dial internal — tick inset, tick length, hand
 * length — is expressed as a fraction of this one value, so the whole face
 * rescales from a single custom property.
 */
const DIAL_DIAMETER = 62

/** Hour-hand thickness. The minute hand steps down 1px, the second hand is a hairline. */
const HAND_THICKNESS = 3

/** Shown when no entry in the city control named a zone this engine recognized. */
const NO_CITIES =
  'No cities yet. Write them as "Berlin|Europe/Berlin", separated by commas — the zone ids come from your own browser, so anything it knows works.'

/**
 * UTC offset as a label: `GMT`, `GMT+2`, `GMT-7`, `GMT+5:30`.
 *
 * Deliberately absolute rather than relative to the viewer ("+8h from you"). A
 * relative label would be computed against the author's machine when `markup`
 * runs and against the taker's when `script` runs, so the exported file would
 * disagree with the preview it came from — exactly the divergence the
 * single-source principle exists to make impossible.
 */
export function gmtOffsetLabel(offsetMinutes: number): string {
  if (!Number.isFinite(offsetMinutes) || offsetMinutes === 0) return 'GMT'
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(Math.round(offsetMinutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `GMT${sign}${h}${m ? ':' + pad2(m) : ''}`
}

/** A working-hours bound as a wall-clock label: `9` -> `09:00`, `9.5` -> `09:30`. */
function hourLabel(hour: number): string {
  const total = Math.round(clamp(Number.isFinite(hour) ? hour : 0, 0, 24) * 60)
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

/** JSON literal safe to embed inside a `<script>` element in the HTML export. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Three decimals, trailing zeros trimmed — readable degrees in the exported markup. */
function deg(n: number): string {
  return `${Math.round(n * 1000) / 1000}deg`
}

/** Indent every non-blank line of a block, so nested markup exports readable. */
function nest(block: string, pad: string): string[] {
  return block.split('\n').map((l) => (l.trim() ? pad + l : l))
}

/** One city cell: a face, the city name, and the day/offset line under it. */
function worldClockCell(city: City, p: Props, now: Date): string {
  const parts = zonedParts(city.zone, now)
  const digital = String(p.face) === 'digital'
  const withSeconds = Boolean(p.seconds)
  const working = Boolean(p.highlight) && isWorkingHour(parts, Number(p.workStart), Number(p.workEnd))

  // A cell with no reading shows no time at all. It never falls back to the
  // viewer's own zone: a face labelled "Berlin" quietly showing Seoul's time is
  // wrong in the one way nobody catches.
  const hhmm = parts ? `${pad2(parts.hour)}:${pad2(parts.minute)}` : ''
  const zoneLine = parts
    ? `${parts.weekday} · ${gmtOffsetLabel(parts.offsetMinutes)}`
    : `${city.zone} unavailable`

  // Hand angles ride on the cell as inline custom properties. They cannot live
  // in the stylesheet: `injectCss` keys its <style> element by widget id, so all
  // six cells share exactly one sheet and per-cell values have nowhere else to go.
  const rot: string[] = []
  if (parts && !digital) {
    const second = parts.second
    const minute = parts.minute + second / 60
    const hour = (parts.hour % 12) + minute / 60
    rot.push(`--wg-rot-hour: ${deg(hour * 30)}`)
    rot.push(`--wg-rot-minute: ${deg(minute * 6)}`)
    if (withSeconds) rot.push(`--wg-rot-second: ${deg(second * 6)}`)
  }
  const style = rot.length ? ` style="${esc(rot.join('; '))}"` : ''
  const cls =
    'wg-world-clock__cell' + (working ? ' is-work' : '') + (parts ? '' : ' is-unavailable')

  const face: string[] = digital
    ? [
        '<span class="wg-world-clock__readout">',
        `  <span class="wg-world-clock__time" data-time>${esc(hhmm)}</span>`,
        ...(withSeconds
          ? [
              `  <span class="wg-world-clock__secs" data-secs>${
                parts ? ':' + pad2(parts.second) : ''
              }</span>`,
            ]
          : []),
        '</span>',
      ]
    : [
        // Four marks, not twelve: at this diameter a full ring reads as texture
        // rather than as the quarters it is there to mark.
        ...[0, 90, 180, 270].map((a) => `<i class="wg-world-clock__tick" style="--i:${a}"></i>`),
        '<i class="wg-world-clock__hand wg-world-clock__hand--hour"></i>',
        '<i class="wg-world-clock__hand wg-world-clock__hand--minute"></i>',
        ...(withSeconds
          ? ['<i class="wg-world-clock__hand wg-world-clock__hand--second"></i>']
          : []),
        // A dial holds no readable time. This carries one for anyone not looking at it.
        `<span class="wg-world-clock__sr" data-sr>${esc(hhmm || 'Time unavailable')}</span>`,
      ]

  // The two faces share a height so the board does not resize when you switch
  // between them, but not a shape: a dial is a circle, a readout is wider than it
  // is tall and would spill out of one.
  const faceCls = 'wg-world-clock__face' + (digital ? ' wg-world-clock__face--wide' : '')

  return [
    `<div class="${cls}" data-city data-zone="${esc(city.zone)}"${style}>`,
    `  <span class="${faceCls}">`,
    ...nest(face.join('\n'), '    '),
    '    <span class="wg-world-clock__off" aria-hidden="true">—</span>',
    '  </span>',
    '  <span class="wg-world-clock__meta">',
    `    <span class="wg-world-clock__city">${esc(city.label)}</span>`,
    `    <span class="wg-world-clock__zone" data-zone-line>${esc(zoneLine)}</span>`,
    '  </span>',
    '</div>',
  ].join('\n')
}

export const worldClock: WidgetSpec = {
  id: 'world-clock',
  name: 'World Clock',
  category: 'time',
  blurb: 'Up to six cities on one board, analog or digital, with working hours lit.',
  tags: ['clock', 'time', 'timezone', 'team'],
  frame: { w: 372, h: 282 },
  controls: [
    {
      key: 'cities',
      label: 'Cities',
      // The studio edits this as rows; the value it writes is still the one
      // delimited string `parseCities` reads, so links and exports are unchanged.
      type: 'citylist',
      default:
        'San Francisco|America/Los_Angeles, New York|America/New_York, London|Europe/London, Berlin|Europe/Berlin, Mumbai|Asia/Kolkata, Seoul|Asia/Seoul',
      max: MAX_CITIES,
    },
    {
      key: 'face',
      label: 'Face',
      type: 'select',
      default: 'analog',
      options: [
        { value: 'analog', label: 'Analog' },
        { value: 'digital', label: 'Digital' },
      ],
    },
    { key: 'seconds', label: 'Show seconds', type: 'boolean', default: true },
    { key: 'smooth', label: 'Sweeping second', type: 'boolean', default: true },
    { key: 'highlight', label: 'Light working hours', type: 'boolean', default: true, group: 'Working hours' },
    { key: 'workStart', label: 'Starts', type: 'number', default: 9, min: 0, max: 24, step: 0.5, unit: 'h', group: 'Working hours' },
    { key: 'workEnd', label: 'Ends', type: 'number', default: 18, min: 0, max: 24, step: 0.5, unit: 'h', group: 'Working hours' },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Working hours', type: 'color', default: '#3ef07d', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
    '--wg-dial': `${DIAL_DIAMETER}px`,
    '--wg-hand': `${HAND_THICKNESS}px`,
  }),
  markup: (p) => {
    const cities = parseCities(String(p.cities))
    if (!cities.length) return `<p class="wg-world-clock__empty">${esc(NO_CITIES)}</p>`
    const now = new Date()
    return [
      '<div class="wg-world-clock__grid">',
      ...nest(cities.map((c) => worldClockCell(c, p, now)).join('\n'), '  '),
      '</div>',
      // The tint needs a caption. Without one it reads as decoration rather than
      // as the answer to "is it a reasonable hour there".
      ...(p.highlight
        ? [
            '<p class="wg-world-clock__legend">',
            '  <i aria-hidden="true"></i>',
            `  <span>Working hours ${hourLabel(Number(p.workStart))}–${hourLabel(
              Number(p.workEnd),
            )}, local to each city.</span>`,
            '</p>',
          ]
        : []),
    ].join('\n')
  },
  css: () => dedent(`
    .wg-world-clock {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 372px;
      padding: 20px;
      box-sizing: border-box;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .wg-world-clock__grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .wg-world-clock__cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-width: 0;
      opacity: .7;
      transition: opacity .3s ease;
    }
    .wg-world-clock__cell.is-work { opacity: 1; }
    .wg-world-clock__face {
      position: relative;
      display: grid;
      place-items: center;
      width: var(--wg-dial);
      height: var(--wg-dial);
      border-radius: 50%;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      transition: background .3s ease;
    }
    .wg-world-clock__face--wide { width: 100%; border-radius: 99px; }
    .wg-world-clock__cell.is-work .wg-world-clock__face {
      background: color-mix(in srgb, var(--wg-accent) 35%, transparent);
    }
    .wg-world-clock__tick {
      position: absolute;
      left: 50%;
      top: calc(var(--wg-dial) * .08);
      width: 2px;
      height: calc(var(--wg-dial) * .1);
      margin-left: -1px;
      border-radius: 99px;
      background: currentColor;
      opacity: .35;
      transform-origin: 50% calc(var(--wg-dial) * .42);
      transform: rotate(calc(var(--i) * 1deg));
    }
    .wg-world-clock__hand {
      position: absolute;
      left: 50%;
      bottom: 50%;
      border-radius: 99px;
      background: currentColor;
      transform-origin: 50% 100%;
      transform: translateX(-50%) rotate(var(--wg-rot, 0deg));
    }
    .wg-world-clock__hand--hour {
      width: var(--wg-hand);
      height: calc(var(--wg-dial) * .26);
      --wg-rot: var(--wg-rot-hour, 0deg);
    }
    .wg-world-clock__hand--minute {
      width: calc(var(--wg-hand) - 1px);
      height: calc(var(--wg-dial) * .36);
      --wg-rot: var(--wg-rot-minute, 0deg);
    }
    .wg-world-clock__hand--second {
      width: calc(var(--wg-hand) - 2px);
      height: calc(var(--wg-dial) * .4);
      opacity: .55;
      --wg-rot: var(--wg-rot-second, 0deg);
    }
    .wg-world-clock__readout { display: flex; align-items: baseline; }
    .wg-world-clock__time {
      font-size: 22px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: -.02em;
      font-variant-numeric: tabular-nums;
    }
    .wg-world-clock__secs {
      font-size: 12px;
      opacity: .55;
      font-variant-numeric: tabular-nums;
    }
    .wg-world-clock__off { display: none; font-size: 18px; opacity: .35; line-height: 1; }
    .wg-world-clock__cell.is-unavailable .wg-world-clock__off { display: block; }
    .wg-world-clock__cell.is-unavailable .wg-world-clock__readout,
    .wg-world-clock__cell.is-unavailable .wg-world-clock__tick,
    .wg-world-clock__cell.is-unavailable .wg-world-clock__hand { display: none; }
    .wg-world-clock__meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      max-width: 100%;
    }
    .wg-world-clock__city {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 600;
      transition: color .3s ease;
    }
    .wg-world-clock__cell.is-work .wg-world-clock__city { color: var(--wg-accent); }
    .wg-world-clock__zone {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
      opacity: .55;
      font-variant-numeric: tabular-nums;
    }
    .wg-world-clock__legend {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 11px;
      opacity: .55;
    }
    .wg-world-clock__legend i {
      flex: 0 0 auto;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--wg-accent);
    }
    .wg-world-clock__empty { margin: 0; font-size: 12px; line-height: 1.3; opacity: .55; }
    .wg-world-clock__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-world-clock__cell,
      .wg-world-clock__face,
      .wg-world-clock__city { transition: none; }
    }
  `),
  script: (p) => {
    const cities = parseCities(String(p.cities))
    const digital = String(p.face) === 'digital'
    const on = Boolean(p.highlight)
    const from = on ? Math.round(clamp(Number(p.workStart), 0, 24) * 60) : -1
    const to = on ? Math.round(clamp(Number(p.workEnd), 0, 24) * 60) : -1
    return dedent(`
      var CITIES = ${scriptJson(cities)};
      var DIGITAL = ${digital ? 'true' : 'false'};
      var SECONDS = ${p.seconds ? 'true' : 'false'};
      var SMOOTH = ${p.smooth ? 'true' : 'false'};
      var FROM = ${from}, TO = ${to};
      var cells = root.querySelectorAll('[data-city]');
      if (!cells.length) return function () {};

      // Reduced motion is answered here, not only in the stylesheet: the sweeping
      // hand is driven by a frame loop, and a media query cannot stop a loop. Under
      // 'reduce' the board keeps perfect time on a one-second interval instead.
      var mq = null;
      try {
        mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
      } catch (e) { mq = null; }
      function sweeping() { return SMOOTH && SECONDS && !DIGITAL && !(mq && mq.matches); }

      // One formatter per city, built once. A zone this engine does not know is
      // remembered as null and stays blank forever after — never resolved to the
      // viewer's own zone, which would read as correct while being wrong.
      var fmts = [], lastLine = [], lastTime = [];
      for (var i = 0; i < CITIES.length; i++) {
        fmts.push(formatter(CITIES[i].zone));
        lastLine.push(null);
        lastTime.push(null);
      }
      function formatter(zone) {
        try {
          return new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
            day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
          });
        } catch (e) { return null; }
      }
      function pad2(n) { return (n < 10 ? '0' : '') + n; }
      function gmt(off) {
        if (!off) return 'GMT';
        var sign = off < 0 ? '-' : '+', abs = Math.abs(off);
        var h = Math.floor(abs / 60), m = abs % 60;
        return 'GMT' + sign + h + (m ? ':' + pad2(m) : '');
      }
      function read(i, now) {
        var f = fmts[i];
        if (!f) return null;
        var bag = {}, list = f.formatToParts(now);
        for (var j = 0; j < list.length; j++) {
          if (list[j].type !== 'literal') bag[list[j].type] = list[j].value;
        }
        var y = +bag.year, mo = +bag.month, d = +bag.day;
        var h = +bag.hour % 24, mi = +bag.minute, s = +bag.second;
        if (!isFinite(y) || !isFinite(mo) || !isFinite(d) || !isFinite(h) || !isFinite(mi) || !isFinite(s)) return null;
        return {
          hour: h, minute: mi, second: s, weekday: bag.weekday || '', minutes: h * 60 + mi,
          offset: Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - now.getTime()) / 60000)
        };
      }
      function working(parts) {
        if (!parts || FROM < 0 || FROM === TO) return false;
        return FROM < TO
          ? (parts.minutes >= FROM && parts.minutes < TO)
          : (parts.minutes >= FROM || parts.minutes < TO);
      }
      function render() {
        var now = new Date(), ms = now.getMilliseconds(), sweep = sweeping();
        for (var i = 0; i < cells.length; i++) {
          var cell = cells[i], parts = read(i, now);
          if (!parts) {
            if (!cell.classList.contains('is-unavailable')) {
              cell.classList.add('is-unavailable');
              cell.classList.remove('is-work');
              cell.style.removeProperty('--wg-rot-hour');
              cell.style.removeProperty('--wg-rot-minute');
              cell.style.removeProperty('--wg-rot-second');
              write(cell, '[data-time]', '');
              write(cell, '[data-secs]', '');
              write(cell, '[data-sr]', 'Time unavailable');
              write(cell, '[data-zone-line]', (CITIES[i] ? CITIES[i].zone : '') + ' unavailable');
              lastLine[i] = null;
              lastTime[i] = null;
            }
            continue;
          }
          cell.classList.remove('is-unavailable');
          cell.classList.toggle('is-work', working(parts));
          if (DIGITAL) {
            var stamp = pad2(parts.hour) + ':' + pad2(parts.minute) + ':' + pad2(parts.second);
            if (stamp !== lastTime[i]) {
              write(cell, '[data-time]', stamp.slice(0, 5));
              write(cell, '[data-secs]', ':' + stamp.slice(6));
              lastTime[i] = stamp;
            }
          } else {
            var sec = parts.second + (sweep ? ms / 1000 : 0);
            var min = parts.minute + sec / 60;
            var hour = (parts.hour % 12) + min / 60;
            cell.style.setProperty('--wg-rot-hour', (hour * 30) + 'deg');
            cell.style.setProperty('--wg-rot-minute', (min * 6) + 'deg');
            if (SECONDS) cell.style.setProperty('--wg-rot-second', (sec * 6) + 'deg');
            var label = pad2(parts.hour) + ':' + pad2(parts.minute);
            if (label !== lastTime[i]) {
              write(cell, '[data-sr]', label);
              lastTime[i] = label;
            }
          }
          var line = parts.weekday + ' \\u00b7 ' + gmt(parts.offset);
          if (line !== lastLine[i]) {
            write(cell, '[data-zone-line]', line);
            lastLine[i] = line;
          }
        }
      }
      function write(cell, sel, text) {
        var el = cell.querySelector(sel);
        if (el) el.textContent = text;
      }

      var frame = 0, timer = 0;
      function stop() {
        if (frame) cancelAnimationFrame(frame);
        if (timer) clearInterval(timer);
        frame = 0;
        timer = 0;
      }
      function start() {
        stop();
        render();
        if (sweeping()) {
          var loop = function () { render(); frame = requestAnimationFrame(loop); };
          frame = requestAnimationFrame(loop);
        } else {
          timer = setInterval(render, 1000);
        }
      }
      var onMotionChange = function () { start(); };
      if (mq && mq.addEventListener) mq.addEventListener('change', onMotionChange);
      start();
      return function () {
        stop();
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onMotionChange);
      };
    `)
  },
}
