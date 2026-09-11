import type { Props, WidgetSpec } from '../lib/types'
import { dedent, esc } from '../lib/util'

const SUN_DOT = '<circle class="wg-weather__sun" cx="21" cy="9" r="6"></circle>'

const SKY: Record<string, string> = {
  sun: '<circle cx="16" cy="16" r="8" fill="currentColor"></circle>',
  cloud:
    '<path d="M9 24h13a6 6 0 0 0 .6-11.97A8.5 8.5 0 0 0 6.6 14.2 5 5 0 0 0 9 24z" fill="currentColor"></path>',
  rain:
    '<path d="M9 21h13a6 6 0 0 0 .6-11.97A8.5 8.5 0 0 0 6.6 11.2 5 5 0 0 0 9 21z" fill="currentColor"></path>' +
    '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".75">' +
    '<path d="M11 24.5l-1.6 3.6"></path><path d="M17 24.5l-1.6 3.6"></path><path d="M23 24.5l-1.6 3.6"></path></g>',
}

/**
 * WMO weather code -> [condition wording, glyph key]. The card owns three glyphs,
 * so snow rides the plain cloud rather than the rain drips: the wording carries the
 * distinction and no glyph claims weather the card cannot draw.
 */
const WMO: Record<number, [string, string]> = {
  0: ['Clear', 'sun'],
  1: ['Mainly Clear', 'sun'],
  2: ['Partly Cloudy', 'cloud'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud'],
  48: ['Rime Fog', 'cloud'],
  51: ['Light Drizzle', 'rain'],
  53: ['Drizzle', 'rain'],
  55: ['Heavy Drizzle', 'rain'],
  56: ['Freezing Drizzle', 'rain'],
  57: ['Freezing Drizzle', 'rain'],
  61: ['Light Rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy Rain', 'rain'],
  66: ['Freezing Rain', 'rain'],
  67: ['Freezing Rain', 'rain'],
  71: ['Light Snow', 'cloud'],
  73: ['Snow', 'cloud'],
  75: ['Heavy Snow', 'cloud'],
  77: ['Snow Grains', 'cloud'],
  80: ['Rain Showers', 'rain'],
  81: ['Rain Showers', 'rain'],
  82: ['Heavy Showers', 'rain'],
  85: ['Snow Showers', 'cloud'],
  86: ['Snow Showers', 'cloud'],
  95: ['Thunderstorm', 'rain'],
  96: ['Thunderstorm', 'rain'],
  99: ['Thunderstorm', 'rain'],
}

/**
 * Embed a value in a generated script as a JS literal. `JSON.stringify` alone is not
 * enough: a widget's own props end up inside a `<script>` block in the HTML export, so
 * `<` is escaped to keep a value like `</script>` from closing the block, and the two
 * Unicode line terminators are escaped because they are legal inside a JSON string but
 * not inside a JS one.
 */
function jsLit(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Day labels the Outlook Strip falls back to when fewer than three are authored. */
const SAMPLE_DAYS = ['MON', 'TUE', 'WED']

/** The sample sky per Day Cell. One clear day, so exactly one cell carries the accent. */
const SAMPLE_DAY_SKY = ['cloud', 'cloud', 'sun']

/** The Unit Toggle, in the order it is read. Both options are always on the card. */
const UNIT_LABEL: [string, string][] = [
  ['f', '°F'],
  ['c', '°C'],
]

/**
 * What the Status Caption says in each state. `live` says nothing at all: a card
 * showing current figures for the named place makes no claim about itself.
 */
const CAPTION = {
  loading: 'Checking the sky…',
  sample: 'Sample reading',
  offline: 'No reading available — showing a sample',
}

function unitOf(p: Props): 'f' | 'c' {
  return String(p.units) === 'c' ? 'c' : 'f'
}

/** Sample figures are authored in Fahrenheit; the toggle converts, it never re-reads. */
function inUnit(t: number, from: 'f' | 'c', to: 'f' | 'c'): number {
  if (from === to) return t
  return to === 'c' ? ((t - 32) * 5) / 9 : (t * 9) / 5 + 32
}

function readout(t: number, unit: 'f' | 'c'): string {
  return `${Math.round(t)}°${unit.toUpperCase()}`
}

/** Exactly three labels, always: the strip is three Day Cells wide in every state. */
function dayLabels(p: Props): string[] {
  const typed = String(p.days)
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
  return SAMPLE_DAYS.map((fallback, i) => typed[i] ?? fallback)
}

/** True when the card both may ask for a reading and has a place to ask about. */
function asking(p: Props): boolean {
  return p.live === true && String(p.city).trim() !== ''
}

export const weather: WidgetSpec = {
  id: 'weather',
  name: 'Forecast Card',
  category: 'data',
  blurb: 'Live conditions for a city you pick, with a sample reading when offline.',
  tags: ['weather', 'forecast', 'card'],
  frame: { w: 380, h: 260 },
  interactive: true,
  controls: [
    { key: 'live', label: 'Live data', type: 'boolean', default: true },
    { key: 'city', label: 'City', type: 'text', default: 'San Francisco', maxLength: 64 },
    {
      key: 'units',
      label: 'Units',
      type: 'select',
      default: 'f',
      options: [
        { value: 'f', label: '°F' },
        { value: 'c', label: '°C' },
      ],
    },
    { key: 'drift', label: 'Drifting clouds', type: 'boolean', default: true },
    {
      key: 'temp',
      label: 'Temperature',
      type: 'number',
      default: 79,
      min: -60,
      max: 130,
      step: 1,
      unit: '°F',
      group: 'Sample reading',
    },
    {
      key: 'condition',
      label: 'Condition',
      type: 'text',
      default: 'Partly Cloudy with Light Rain',
      group: 'Sample reading',
    },
    {
      key: 'icon',
      label: 'Icon',
      type: 'select',
      default: 'rain',
      group: 'Sample reading',
      options: [
        { value: 'sun', label: 'Clear' },
        { value: 'cloud', label: 'Cloudy' },
        { value: 'rain', label: 'Rain' },
      ],
    },
    { key: 'days', label: 'Day labels', type: 'text', default: 'MON,TUE,WED', group: 'Sample reading' },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Sun', type: 'color', default: '#ff9f2e', group: 'Color' },
  ],
  /**
   * The card's whole token layer, written onto the root as custom properties. Nothing
   * in `css` below is a literal design value: every colour, size, gap, corner, opacity
   * and duration is read back from here, so a taker restyles the card by overriding
   * tokens rather than by hunting through rules. The four data states are expressed the
   * same way - they re-point which of these tokens is in force and change nothing else.
   */
  vars: (p) => ({
    /* colour */
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
    /* typography */
    /* Unquoted on purpose. Every token value is written into an HTML attribute by the
       Svelte and Vue targets, so a quote here would close that attribute and drop the
       rest of the token layer on the floor. A multi-word family name is legal CSS
       unquoted, so the card asks for nothing it has to quote. */
    '--wg-font': 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
    '--wg-text-xs': '10px',
    '--wg-text-sm': '12px',
    '--wg-text-md': '13px',
    '--wg-text-display': '32px',
    '--wg-weight-regular': '500',
    '--wg-weight-strong': '600',
    '--wg-line-tight': '1',
    '--wg-line-snug': '1.3',
    '--wg-track-tight': '-.02em',
    '--wg-track-wide': '.1em',
    /* spacing */
    '--wg-gap-2xs': '4px',
    '--wg-gap-xs': '8px',
    '--wg-gap-sm': '12px',
    '--wg-gap-md': '16px',
    '--wg-gap-lg': '18px',
    '--wg-inset-card-block': '22px',
    '--wg-inset-card-inline': '24px',
    /* radius */
    '--wg-radius-card': '26px',
    '--wg-radius-control': '999px',
    '--wg-radius-inline': '6px',
    /* emphasis */
    '--wg-emphasis-primary': '1',
    '--wg-emphasis-secondary': '.55',
    '--wg-emphasis-tertiary': '.45',
    '--wg-emphasis-placeholder': '.3',
    /* motion */
    '--wg-duration-quick': '.15s',
    '--wg-duration-base': '.3s',
    '--wg-ease-standard': 'ease',
    '--wg-ease-loop': 'ease-in-out',
    '--wg-loop-drift': '5s',
    '--wg-loop-breathe': '1.8s',
  }),
  /**
   * One structure, four states. No state adds, removes or reorders a part, so moving
   * between them never shifts anything on the card - the state only decides which
   * emphasis and accent each part is drawn at, and whether the caption has anything
   * to say. The state lives on the card element because the root carries the tokens.
   *
   * The place field ships read-only and the script unlocks it, so a card with no
   * script still names its place and never offers a search it cannot run.
   *
   * The painted state is always `no-data`, because that is the truth about markup on
   * its own: the figures in it are the sample ones. A live script moves the card to
   * `loading` on the same tick it mounts, and the export targets that ship no script
   * at all are left in the one state that needs none to be honest - rather than frozen
   * forever in a skeleton that only a script could have lifted.
   */
  markup: (p) => {
    const unit = unitOf(p)
    const glyph = SKY[String(p.icon)] ?? SKY.cloud
    const units = UNIT_LABEL.map(
      ([u, label]) =>
        `<button class="wg-weather__unit${u === unit ? ' is-on' : ''}" type="button"
                  data-unit="${u}" aria-pressed="${u === unit ? 'true' : 'false'}">${label}</button>`,
    ).join('\n          ')
    const days = dayLabels(p)
      .map(
        (d, i) => `<div class="wg-weather__day">
          <span>${esc(d)}</span>
          <svg viewBox="0 0 32 32" aria-hidden="true" class="wg-weather__mini${SAMPLE_DAY_SKY[i] === 'sun' ? ' is-clear' : ''}">
            ${SKY[SAMPLE_DAY_SKY[i]]}
          </svg>
        </div>`,
      )
      .join('\n        ')
    return dedent(`
      <div class="wg-weather__card" data-state="no-data">
        <div class="wg-weather__bar">
          <input class="wg-weather__place" type="text" data-place readonly
                 value="${esc(String(p.city).trim())}" placeholder="Search a city" aria-label="City" />
          <div class="wg-weather__units" role="group" aria-label="Temperature unit">
            ${units}
          </div>
        </div>
        <div class="wg-weather__now">
          <svg class="wg-weather__glyph${p.drift ? ' is-drifting' : ''}" viewBox="0 0 32 32" aria-hidden="true">
            ${SUN_DOT}
            ${glyph}
          </svg>
          <div class="wg-weather__read">
            <strong class="wg-weather__temp">${readout(inUnit(Number(p.temp), 'f', unit), unit)}</strong>
            <span class="wg-weather__condition">${esc(String(p.condition))}</span>
          </div>
        </div>
        <div class="wg-weather__strip">
          ${days}
        </div>
        <p class="wg-weather__status" data-status aria-live="polite">${CAPTION.sample}</p>
      </div>
    `)
  },
  css: () => dedent(`
    .wg-weather {
      width: 360px;
      box-sizing: border-box;
      padding: var(--wg-inset-card-block) var(--wg-inset-card-inline);
      border-radius: var(--wg-radius-card);
      background: var(--wg-bg);
      color: var(--wg-ink);
      font-family: var(--wg-font);
      font-size: var(--wg-text-md);
      font-weight: var(--wg-weight-regular);
      line-height: var(--wg-line-snug);
    }

    /* Three emphasis slots and one accent cue. Each state re-points them and touches
       nothing else, which is what keeps a state change from moving the card. */
    .wg-weather__card {
      --wg-em-read: var(--wg-emphasis-primary);
      --wg-em-caption: var(--wg-emphasis-secondary);
      --wg-em-label: var(--wg-emphasis-tertiary);
      --wg-cue: var(--wg-accent);
      display: flex;
      flex-direction: column;
      gap: var(--wg-gap-lg);
    }
    .wg-weather__card[data-state="loading"] {
      --wg-em-read: var(--wg-emphasis-placeholder);
      --wg-em-caption: var(--wg-emphasis-placeholder);
      --wg-em-label: var(--wg-emphasis-placeholder);
    }
    .wg-weather__card[data-state="stale"] {
      --wg-em-read: var(--wg-emphasis-secondary);
      --wg-em-caption: var(--wg-emphasis-tertiary);
      --wg-em-label: var(--wg-emphasis-tertiary);
    }
    /* A sample reading drops the warm cue to plain ink: nothing illustrative gets to
       wear the mark that singles out a measured value. */
    .wg-weather__card[data-state="no-data"] {
      --wg-em-read: var(--wg-emphasis-secondary);
      --wg-em-caption: var(--wg-emphasis-tertiary);
      --wg-em-label: var(--wg-emphasis-tertiary);
      --wg-cue: var(--wg-ink);
    }

    .wg-weather__bar { display: flex; align-items: center; gap: var(--wg-gap-sm); }
    .wg-weather__place {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-overflow: ellipsis;
      opacity: var(--wg-em-caption);
      transition: opacity var(--wg-duration-quick) var(--wg-ease-standard);
    }
    .wg-weather__place::placeholder { color: currentColor; opacity: var(--wg-emphasis-primary); }
    .wg-weather__place:hover:not([readonly]), .wg-weather__place:focus { opacity: var(--wg-em-read); }
    .wg-weather__place:focus {
      outline: none;
      text-decoration: underline;
      text-underline-offset: var(--wg-gap-2xs);
    }

    .wg-weather__units { display: flex; align-items: center; gap: var(--wg-gap-2xs); flex: 0 0 auto; }
    .wg-weather__unit {
      margin: 0;
      padding: var(--wg-gap-2xs) var(--wg-gap-xs);
      border: 0;
      background: none;
      color: inherit;
      cursor: pointer;
      font-family: inherit;
      font-size: var(--wg-text-sm);
      font-weight: var(--wg-weight-regular);
      line-height: var(--wg-line-tight);
      letter-spacing: var(--wg-track-wide);
      border-radius: var(--wg-radius-control);
      opacity: var(--wg-em-label);
      transition: opacity var(--wg-duration-quick) var(--wg-ease-standard),
                  color var(--wg-duration-quick) var(--wg-ease-standard);
    }
    .wg-weather__unit:hover { opacity: var(--wg-em-caption); }
    .wg-weather__unit:focus-visible {
      outline: none;
      text-decoration: underline;
      text-underline-offset: var(--wg-gap-2xs);
    }
    .wg-weather__unit.is-on {
      color: var(--wg-cue);
      font-weight: var(--wg-weight-strong);
      opacity: var(--wg-em-read);
    }

    .wg-weather__now { display: flex; align-items: center; gap: var(--wg-gap-md); }
    .wg-weather__glyph {
      width: 74px;
      height: 74px;
      flex: 0 0 auto;
      color: var(--wg-ink);
      opacity: var(--wg-em-read);
      transition: opacity var(--wg-duration-base) var(--wg-ease-standard);
    }
    .wg-weather__sun { fill: var(--wg-cue); }
    .wg-weather__glyph.is-drifting {
      animation: wg-weather-drift var(--wg-loop-drift) var(--wg-ease-loop) infinite;
    }
    .wg-weather__read {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--wg-gap-2xs);
      min-width: 0;
    }
    .wg-weather__temp {
      font-size: var(--wg-text-display);
      font-weight: var(--wg-weight-strong);
      line-height: var(--wg-line-tight);
      letter-spacing: var(--wg-track-tight);
      opacity: var(--wg-em-read);
      transition: opacity var(--wg-duration-base) var(--wg-ease-standard);
    }
    .wg-weather__condition { font-size: var(--wg-text-sm); opacity: var(--wg-em-caption); }

    .wg-weather__strip { display: flex; justify-content: space-between; gap: var(--wg-gap-xs); }
    .wg-weather__day {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--wg-gap-xs);
      flex: 1 1 0;
    }
    .wg-weather__day span {
      font-size: var(--wg-text-xs);
      line-height: var(--wg-line-tight);
      letter-spacing: var(--wg-track-wide);
      opacity: var(--wg-em-label);
    }
    .wg-weather__mini { width: 30px; height: 30px; color: var(--wg-ink); opacity: var(--wg-em-read); }
    .wg-weather__mini.is-clear { color: var(--wg-cue); }

    /* The caption holds its line whether or not it has something to say, so a live
       card and a stale one are exactly the same height. */
    .wg-weather__status {
      margin: 0;
      min-height: calc(var(--wg-text-sm) * var(--wg-line-snug));
      font-size: var(--wg-text-sm);
      opacity: var(--wg-em-label);
    }

    /* The skeleton veil. Each figure keeps its own box and is drawn as a bar instead
       of text, so nothing claims to be a measurement and nothing moves when one lands. */
    .wg-weather__card[data-state="loading"] .wg-weather__temp,
    .wg-weather__card[data-state="loading"] .wg-weather__condition,
    .wg-weather__card[data-state="loading"] .wg-weather__day span {
      color: transparent;
      background: var(--wg-ink);
      border-radius: var(--wg-radius-inline);
      animation: wg-weather-breathe var(--wg-loop-breathe) var(--wg-ease-loop) infinite;
    }
    .wg-weather__card[data-state="loading"] .wg-weather__glyph,
    .wg-weather__card[data-state="loading"] .wg-weather__mini {
      background: var(--wg-ink);
      border-radius: var(--wg-radius-control);
      animation: wg-weather-breathe var(--wg-loop-breathe) var(--wg-ease-loop) infinite;
    }
    .wg-weather__card[data-state="loading"] .wg-weather__glyph > *,
    .wg-weather__card[data-state="loading"] .wg-weather__mini > * { visibility: hidden; }

    @keyframes wg-weather-drift {
      0%, 100% { transform: translateX(0); }
      50% { transform: translateX(4px); }
    }
    @keyframes wg-weather-breathe {
      0%, 100% { opacity: var(--wg-emphasis-placeholder); }
      50% { opacity: var(--wg-emphasis-tertiary); }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-weather__glyph.is-drifting,
      .wg-weather__card[data-state="loading"] .wg-weather__temp,
      .wg-weather__card[data-state="loading"] .wg-weather__condition,
      .wg-weather__card[data-state="loading"] .wg-weather__day span,
      .wg-weather__card[data-state="loading"] .wg-weather__glyph,
      .wg-weather__card[data-state="loading"] .wg-weather__mini { animation: none; }
      .wg-weather__place,
      .wg-weather__unit,
      .wg-weather__glyph,
      .wg-weather__temp { transition: none; }
    }
  `),
  /**
   * Two halves. The first runs everywhere and needs no network at all: it holds the
   * state, answers the Unit Toggle by converting the figures already on the card, and
   * fills the place field. The second half is appended only when the card is allowed
   * to read, and is the only part that knows what a request is - so a card with `live`
   * off ships a working toggle and not one line of networking.
   *
   * Failure is never rendered as an error. Every dead end repaints the sample reading
   * and says so in the caption, which is what keeps the gallery tile, the landing
   * collage and a downloaded file honest with no provider reachable.
   */
  script: (p) => {
    const unit = unitOf(p)
    const sample = {
      t: Number(p.temp),
      u: 'f',
      label: String(p.condition),
      icon: SKY[String(p.icon)] ? String(p.icon) : 'cloud',
      days: dayLabels(p).map((label, i) => ({ label, icon: SAMPLE_DAY_SKY[i] })),
    }

    const core = `
      var card = root.querySelector('.wg-weather__card');
      var out = root.querySelector('.wg-weather__temp');
      var note = root.querySelector('[data-status]');
      var field = root.querySelector('[data-place]');
      var units = root.querySelectorAll('[data-unit]');
      var CITY = ${jsLit(String(p.city).trim())};
      var UNIT = ${jsLit(unit)};
      var SAMPLE = ${jsLit(sample)};
      /* The reading currently on the card, in the unit it was measured in. */
      var shown = SAMPLE;
      var offs = [];
      var dead = false;

      function inUnit(d, u) {
        if (d.u === u) return d;
        return {
          t: u === 'c' ? (d.t - 32) * 5 / 9 : d.t * 9 / 5 + 32,
          u: u, label: d.label, icon: d.icon, days: d.days
        };
      }

      function readout() {
        var d = inUnit(shown, UNIT);
        if (out) out.textContent = Math.round(d.t) + '\\u00b0' + UNIT.toUpperCase();
      }

      function state(name, caption) {
        if (card) card.setAttribute('data-state', name);
        if (note) note.textContent = caption;
      }

      /* The toggle answers in every state because it never asks for anything: it
         re-reads the figure already on the card in the other unit. */
      function pick(u) {
        UNIT = u;
        for (var i = 0; i < units.length; i++) {
          var on = units[i].getAttribute('data-unit') === u;
          units[i].classList.toggle('is-on', on);
          units[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        readout();
      }

      function onUnit(e) { pick(e.currentTarget.getAttribute('data-unit')); }

      for (var u = 0; u < units.length; u++) {
        (function (btn) {
          btn.addEventListener('click', onUnit);
          offs.push(function () { btn.removeEventListener('click', onUnit); });
        })(units[u]);
      }

      /* The typed city is the one value on this card that comes from outside it, and
         it ends up in a URL. Cap it here as well as on the studio control. */
      if (field) {
        field.maxLength = 64;
        field.value = CITY;
      }
    `

    const live = `
      var SUN = ${jsLit(SUN_DOT)};
      var SKY = ${jsLit(SKY)};
      var WMO = ${jsLit(WMO)};
      var DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      /* Ten minutes. One reading per city per unit is plenty for a card you glance at,
         and it keeps a studio knob-turn from hammering a free public endpoint. */
      var TTL = 600000;
      /* The studio re-runs this body on every keystroke in the City field, and each run
         is a fresh mount with a fresh cache key. Without this pause, typing eight
         characters would open sixteen requests, one pair per prefix. The read is held
         for this long and the disposer cancels it, so only the name still standing when
         the typing stops is ever asked for. */
      var SETTLE = 400;

      /* The cache hangs off the window, not this closure: the studio re-runs this whole
         body on every knob turn, so a closure-held cache would die on each edit and the
         unit toggle would go back to the network for figures it already has. */
      var scope = (root.ownerDocument && root.ownerDocument.defaultView) || root;
      var store = scope.__wgWeatherCache || (scope.__wgWeatherCache = {});
      var ctrl = null;
      var pending = null;
      /* Every read carries a number. A reply from an older one is ignored, so a second
         city typed mid-flight can never be answered by the first. */
      var gen = 0;

      function key(unit) { return CITY.toLowerCase() + '|' + unit; }
      function num(v) { return typeof v === 'number' && isFinite(v); }
      /* The code came off the wire, so it is only ever used as a number: a string key
         would reach Object.prototype and hand back something that is not a reading. */
      function sky(code) {
        var hit = num(code) ? WMO[code] : null;
        return hit && hit.length === 2 ? hit : ['Cloudy', 'cloud'];
      }
      function other(d) { return inUnit(d, d.u === 'c' ? 'f' : 'c'); }
      /* Writing also sweeps. The store hangs off the window and is keyed by whatever
         was typed, so without this every abandoned prefix would sit there for the life
         of the tab. An entry past the window is unusable anyway. */
      function put(d) {
        var now = Date.now();
        for (var k in store) {
          if (Object.prototype.hasOwnProperty.call(store, k) && now - store[k].at >= TTL) delete store[k];
        }
        store[key(d.u)] = { at: now, data: d };
      }

      function paint(d) {
        shown = d;
        readout();
        var cond = root.querySelector('.wg-weather__condition');
        if (cond) cond.textContent = d.label;
        var glyph = root.querySelector('.wg-weather__glyph');
        if (glyph) glyph.innerHTML = SUN + (SKY[d.icon] || SKY.cloud);
        var cells = root.querySelectorAll('.wg-weather__day');
        for (var i = 0; i < cells.length && i < d.days.length; i++) {
          var label = cells[i].querySelector('span');
          if (label) label.textContent = d.days[i].label;
          var mini = cells[i].querySelector('svg');
          if (mini) {
            mini.innerHTML = SKY[d.days[i].icon] || SKY.cloud;
            mini.classList.toggle('is-clear', d.days[i].icon === 'sun');
          }
        }
      }

      function ago(at) {
        var mins = Math.round((Date.now() - at) / 60000);
        return 'Cached \\u00b7 ' + (mins < 1 ? 'just now' : mins + ' min ago');
      }

      /* Every dead end lands here: the card goes back to the sample reading and says
         so, rather than rendering an error in its own place. */
      function offline() {
        paint(SAMPLE);
        state('no-data', ${jsLit(CAPTION.offline)});
      }

      /* Everything past this point came off the wire, so nothing is believed until it
         has been checked. A response that does not carry a finite temperature is no
         reading at all and the sample stands. */
      function shape(fc, u) {
        if (!fc || !fc.current || !fc.daily) return null;
        if (!num(fc.current.temperature_2m)) return null;
        var now = sky(fc.current.weather_code);
        var times = fc.daily.time || [];
        var codes = fc.daily.weather_code || [];
        var days = [];
        for (var i = 1; i < times.length; i++) {
          var when = new Date(times[i] + 'T00:00:00Z');
          if (isNaN(when.getTime())) continue;
          days.push({ label: DAY[when.getUTCDay()], icon: sky(codes[i])[1] });
        }
        /* The strip is three Day Cells wide in every state. A payload that cannot fill
           them is not a reading: painting it would leave sample days standing beside a
           measured temperature, which is the one thing the card must never do. */
        if (days.length < 3) return null;
        return { t: fc.current.temperature_2m, u: u, label: now[0], icon: now[1], days: days };
      }

      function get(url, signal) {
        return fetch(url, signal ? { signal: signal } : undefined).then(function (res) {
          if (!res || !res.ok) return Promise.reject(new Error('weather: request refused'));
          return res.json();
        });
      }

      function load(mine, signal) {
        return get('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(CITY), signal)
          .then(function (geo) {
            if (dead || mine !== gen) return;
            var spot = geo && geo.results && geo.results[0];
            /* No such place: stop here rather than opening a second request for it. */
            if (!spot || !num(spot.latitude) || !num(spot.longitude)) { offline(); return; }
            /* The unit is fixed here, at the moment the URL is built, and travels with
               the reply. The toggle may flip while the request is in flight; a reading
               asked for in Fahrenheit must not come back labelled Celsius. */
            var want = UNIT;
            return get('https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code&daily=weather_code&timezone=auto&forecast_days=7&temperature_unit=' + (want === 'c' ? 'celsius' : 'fahrenheit') + '&latitude=' + spot.latitude + '&longitude=' + spot.longitude, signal)
              .then(function (fc) {
                if (dead || mine !== gen) return;
                var d = shape(fc, want);
                if (!d) { offline(); return; }
                /* One reading fills both unit slots, so the toggle costs no request. */
                put(d);
                put(other(d));
                paint(d);
                state('live', '');
              });
          });
      }

      function read() {
        var mine = ++gen;
        if (ctrl) ctrl.abort();
        if (pending) { clearTimeout(pending); pending = null; }
        var hit = CITY ? store[key(UNIT)] : null;
        if (hit && Date.now() - hit.at < TTL) {
          paint(hit.data);
          state('stale', ago(hit.at));
          return;
        }
        /* The card says it is reading straight away - the pause below is about not
           asking twice for a half-typed name, not about hiding that a read is due. */
        state('loading', ${jsLit(CAPTION.loading)});
        if (!CITY || typeof fetch !== 'function') { offline(); return; }
        pending = setTimeout(function () {
          pending = null;
          if (dead || mine !== gen) return;
          ctrl = typeof AbortController === 'function' ? new AbortController() : null;
          load(mine, ctrl ? ctrl.signal : undefined).catch(function () {
            if (!dead && mine === gen) offline();
          });
        }, SETTLE);
      }

      function search() {
        var next = (field.value || '').trim();
        if (!next) { field.value = CITY; return; }
        /* Re-submitting the name already on the card is normally a no-op. After a dead
           end it is the only retry the reader has, so it is honoured there. */
        var stuck = card && card.getAttribute('data-state') === 'no-data';
        if (!stuck && next.toLowerCase() === CITY.toLowerCase()) return;
        CITY = next;
        read();
      }

      function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); search(); }
      }

      if (field) {
        field.readOnly = false;
        field.addEventListener('change', search);
        field.addEventListener('keydown', onKey);
        offs.push(function () {
          field.removeEventListener('change', search);
          field.removeEventListener('keydown', onKey);
        });
      }

      offs.push(function () {
        if (pending) clearTimeout(pending);
        if (ctrl) ctrl.abort();
      });
      read();
    `

    const close = `
      return function () {
        dead = true;
        for (var o = 0; o < offs.length; o++) offs[o]();
      };
    `

    return dedent(core) + (asking(p) ? '\n' + dedent(live) : '') + '\n' + dedent(close)
  },
}

export const waterwave: WidgetSpec = {
  id: 'waterwave',
  name: 'Liquid Gauge',
  category: 'data',
  blurb: 'A circular gauge filled by a rolling liquid surface.',
  tags: ['gauge', 'progress', 'water'],
  frame: { w: 220, h: 220 },
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 180, min: 120, max: 240, step: 4, unit: 'px' },
    { key: 'level', label: 'Level', type: 'number', default: 46, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'label', label: 'Label', type: 'text', default: 'WATER INTAKE' },
    { key: 'value', label: 'Value', type: 'text', default: '250ml' },
    { key: 'speed', label: 'Wave speed', type: 'number', default: 7, min: 2, max: 20, step: 1, unit: 's' },
    { key: 'bg', label: 'Body', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'water', label: 'Liquid', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-water': String(p.water),
    '--wg-level': `${p.level}%`,
    '--wg-speed': `${p.speed}s`,
  }),
  markup: (p) => dedent(`
    <div class="wg-waterwave__bowl">
      <i class="wg-waterwave__wave wg-waterwave__wave--back"></i>
      <i class="wg-waterwave__wave"></i>
      <div class="wg-waterwave__read">
        <span class="wg-waterwave__label">${esc(String(p.label))}</span>
        <strong class="wg-waterwave__value">${esc(String(p.value))}</strong>
      </div>
    </div>
  `),
  css: () => dedent(`
    .wg-waterwave { width: var(--wg-size); height: var(--wg-size); }
    .wg-waterwave__bowl {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--wg-bg);
      color: var(--wg-ink);
      overflow: hidden;
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .wg-waterwave__wave {
      position: absolute;
      left: -25%;
      width: 150%;
      height: 150%;
      top: calc(100% - var(--wg-level));
      border-radius: 43%;
      background: var(--wg-water);
      transform-origin: 50% 46%;
      transition: top .4s ease;
      animation: wg-waterwave-roll var(--wg-speed) linear infinite;
    }
    .wg-waterwave__wave--back {
      border-radius: 47%;
      opacity: .4;
      animation-duration: calc(var(--wg-speed) * 1.5);
      animation-direction: reverse;
    }
    .wg-waterwave__read {
      position: absolute;
      z-index: 1;
      left: 0; right: 0; top: 24%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      text-align: center;
    }
    .wg-waterwave__label { font-size: 9px; letter-spacing: .16em; opacity: .5; }
    .wg-waterwave__value { font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
    @keyframes wg-waterwave-roll {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-waterwave__wave { animation: none; border-radius: 0; left: 0; width: 100%; }
    }
  `),
}

export const wallet: WidgetSpec = {
  id: 'wallet',
  name: 'Card Stack',
  category: 'data',
  blurb: 'Stacked payment cards that fan open, with the balance underneath.',
  tags: ['wallet', 'finance', 'cards'],
  frame: { w: 220, h: 252 },
  interactive: true,
  controls: [
    { key: 'balance', label: 'Balance', type: 'text', default: '$94,100' },
    { key: 'label', label: 'Label', type: 'text', default: 'BALANCE' },
    { key: 'fan', label: 'Fan open', type: 'boolean', default: true },
    { key: 'bg', label: 'Body', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'c1', label: 'Card 1', type: 'color', default: '#2f8bff', group: 'Cards' },
    { key: 'c2', label: 'Card 2', type: 'color', default: '#ffc32e', group: 'Cards' },
    { key: 'c3', label: 'Card 3', type: 'color', default: '#e03146', group: 'Cards' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-c1': String(p.c1),
    '--wg-c2': String(p.c2),
    '--wg-c3': String(p.c3),
  }),
  markup: (p) => dedent(`
    <div class="wg-wallet__stack${p.fan ? ' is-fanned' : ''}" data-stack>
      <div class="wg-wallet__card wg-wallet__card--1"></div>
      <div class="wg-wallet__card wg-wallet__card--2"></div>
      <div class="wg-wallet__card wg-wallet__card--3">
        <span class="wg-wallet__chip"></span>
        <span class="wg-wallet__mark"><i></i><i></i></span>
      </div>
    </div>
    <div class="wg-wallet__read">
      <span class="wg-wallet__label">${esc(String(p.label))}</span>
      <strong class="wg-wallet__value">${esc(String(p.balance))}</strong>
    </div>
  `),
  css: () => dedent(`
    .wg-wallet {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      width: 190px;
      height: 232px;
      padding: 16px 18px 18px;
      border-radius: 24px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      overflow: hidden;
      box-sizing: border-box;
    }
    .wg-wallet__stack { position: relative; height: 126px; margin: 0 -2px; cursor: pointer; }
    .wg-wallet__card {
      position: absolute;
      left: 0;
      right: 0;
      height: 92px;
      border-radius: 14px;
      transition: transform .45s cubic-bezier(.3, 1, .4, 1);
    }
    .wg-wallet__card--1 { background: var(--wg-c1); top: 0; }
    .wg-wallet__card--2 { background: var(--wg-c2); top: 16px; }
    .wg-wallet__card--3 { background: var(--wg-c3); top: 32px; }
    .wg-wallet__stack.is-fanned .wg-wallet__card--1 { transform: translateY(-6px); }
    .wg-wallet__stack.is-fanned .wg-wallet__card--3 { transform: translateY(6px); }
    .wg-wallet__card--3 { display: flex; align-items: flex-end; justify-content: space-between; padding: 12px 14px; }
    .wg-wallet__chip {
      width: 26px;
      height: 18px;
      border-radius: 4px;
      background: rgba(255, 255, 255, .45);
    }
    .wg-wallet__mark { display: flex; }
    .wg-wallet__mark i {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(255, 255, 255, .55);
    }
    .wg-wallet__mark i + i { margin-left: -7px; background: rgba(255, 255, 255, .8); }
    .wg-wallet__read { display: flex; flex-direction: column; gap: 4px; }
    .wg-wallet__label { font-size: 9px; letter-spacing: .16em; opacity: .5; }
    .wg-wallet__value { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
    @media (prefers-reduced-motion: reduce) {
      .wg-wallet__card { transition: none; }
    }
  `),
  script: () => dedent(`
    var stack = root.querySelector('[data-stack]');
    function flip() { stack.classList.toggle('is-fanned'); }
    stack.addEventListener('click', flip);
    return function () { stack.removeEventListener('click', flip); };
  `),
}

/* ============================== QR encoder ===============================
 * Byte-mode QR Code generator, error-correction level M, versions 1-40.
 * Pure and deterministic: given a string it returns the module matrix, so the
 * same code paints the live preview and every exported (static) file with no
 * runtime dependency and no network call — the export stays offline-scannable.
 * Algorithm adapted from Project Nayuki's public-domain QR reference.
 */

// Error-correction codewords per block, level M, indexed by version (1-40).
const QR_ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
]
// Number of error-correction blocks, level M, indexed by version (1-40).
const QR_NUM_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]

/** Multiply two field elements of GF(256) with the QR reduction polynomial. */
function qrMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** Reed-Solomon generator polynomial coefficients for the given degree. */
function qrRsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = qrMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = qrMul(root, 0x02)
  }
  return result
}

/** Reed-Solomon remainder (the error-correction codewords) for one block. */
function qrRsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    for (let i = 0; i < divisor.length; i++) result[i] ^= qrMul(divisor[i], factor)
  }
  return result
}

/** Total module bits available in a symbol of the given version, before EC. */
function qrRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

/** Data codewords (level M) that fit in the given version. */
function qrDataCodewords(ver: number): number {
  return Math.floor(qrRawDataModules(ver) / 8) - QR_ECC_PER_BLOCK_M[ver] * QR_NUM_BLOCKS_M[ver]
}

/** Centre coordinates of the alignment patterns for the given version. */
function qrAlignPositions(ver: number): number[] {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const size = ver * 4 + 17
  const step = ver === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2
  const result: number[] = []
  for (let pos = size - 7, i = 0; i < numAlign - 1; i++, pos -= step) result.splice(0, 0, pos)
  result.splice(0, 0, 6)
  return result
}

/**
 * Encode `text` (UTF-8, byte mode) as a QR module matrix. `matrix[y][x] === true`
 * marks a dark module. Throws if the text exceeds version-40 capacity.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))

  let version = 1
  for (; version <= 40; version++) {
    const capacityBits = qrDataCodewords(version) * 8
    const ccBits = version <= 9 ? 8 : 16
    if (4 + ccBits + bytes.length * 8 <= capacityBits) break
  }
  if (version > 40) throw new Error('qr: data too long to encode')

  // ---- bit stream: mode + length + payload + terminator + padding ----
  const bb: number[] = []
  const appendBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1)
  }
  appendBits(0b0100, 4) // byte mode
  appendBits(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) appendBits(b, 8)
  const dataCapacityBits = qrDataCodewords(version) * 8
  appendBits(0, Math.min(4, dataCapacityBits - bb.length))
  appendBits(0, (8 - (bb.length % 8)) % 8)
  for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8)

  const dataCodewords = new Array<number>(bb.length >>> 3).fill(0)
  for (let i = 0; i < bb.length; i++) dataCodewords[i >>> 3] |= bb[i] << (7 - (i & 7))

  // ---- split into blocks, add EC codewords, interleave ----
  const numBlocks = QR_NUM_BLOCKS_M[version]
  const blockEccLen = QR_ECC_PER_BLOCK_M[version]
  const rawCodewords = Math.floor(qrRawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const shortBlockDataLen = shortBlockLen - blockEccLen
  const rsDiv = qrRsDivisor(blockEccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockDataLen + (i < numShortBlocks ? 0 : 1)
    const dat = dataCodewords.slice(k, k + datLen)
    k += datLen
    const ecc = qrRsRemainder(dat, rsDiv)
    if (i < numShortBlocks) dat.push(0) // pad short blocks so interleave is rectangular
    blocks.push(dat.concat(ecc))
  }
  const finalCodewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockDataLen || j >= numShortBlocks) finalCodewords.push(blocks[j][i])
    }
  }

  // ---- lay out the module grid ----
  const size = version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    isFn[y][x] = true
  }
  const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0

  // timing patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0)
    setFn(i, 6, i % 2 === 0)
  }
  // finder patterns + separators
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const xx = cx + dx
        const yy = cy + dy
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4)
      }
  }
  drawFinder(3, 3)
  drawFinder(size - 4, 3)
  drawFinder(3, size - 4)
  // alignment patterns
  const alignPos = qrAlignPositions(version)
  const na = alignPos.length
  const drawAlign = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  for (let i = 0; i < na; i++)
    for (let j = 0; j < na; j++) {
      if (!((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)))
        drawAlign(alignPos[i], alignPos[j])
    }

  // format information (level M) for a given mask, plus the fixed dark module
  const drawFormat = (mask: number) => {
    const data = (0 << 3) | mask // level M -> format bits 00
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i))
    setFn(8, 7, getBit(bits, 6))
    setFn(8, 8, getBit(bits, 7))
    setFn(7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i))
    setFn(8, size - 8, true)
  }
  // version information (versions 7+)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFn(a, b, bit)
      setFn(b, a, bit)
    }
  }
  drawFormat(0) // reserve the format cells before data placement

  // ---- weave the codeword bits through the grid ----
  let iBit = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const x = right - k
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x] && iBit < finalCodewords.length * 8) {
          modules[y][x] = getBit(finalCodewords[iBit >>> 3], 7 - (iBit & 7))
          iBit++
        }
      }
    }
  }

  // ---- mask selection by penalty score ----
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (isFn[y][x]) continue
        let invert = false
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break
          case 1: invert = y % 2 === 0; break
          case 2: invert = x % 3 === 0; break
          case 3: invert = (x + y) % 3 === 0; break
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break
        }
        if (invert) modules[y][x] = !modules[y][x]
      }
  }
  const addHistory = (runLen: number, hist: number[]) => {
    if (hist[0] === 0) runLen += size // count the leading white border once
    hist.copyWithin(1, 0)
    hist[0] = runLen
  }
  const countPatterns = (hist: number[]) => {
    const n = hist[1]
    const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n
    return (
      (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) +
      (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0)
    )
  }
  const terminate = (runColor: boolean, runLen: number, hist: number[]) => {
    if (runColor) {
      addHistory(runLen, hist)
      runLen = 0
    }
    runLen += size
    addHistory(runLen, hist)
    return countPatterns(hist)
  }
  const penalty = () => {
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10
    let result = 0
    for (let y = 0; y < size; y++) {
      let runColor = false, runLen = 0
      const hist = [0, 0, 0, 0, 0, 0, 0]
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runLen++
          if (runLen === 5) result += N1
          else if (runLen > 5) result++
        } else {
          addHistory(runLen, hist)
          if (!runColor) result += countPatterns(hist) * N3
          runColor = modules[y][x]
          runLen = 1
        }
      }
      result += terminate(runColor, runLen, hist) * N3
    }
    for (let x = 0; x < size; x++) {
      let runColor = false, runLen = 0
      const hist = [0, 0, 0, 0, 0, 0, 0]
      for (let y = 0; y < size; y++) {
        if (modules[y][x] === runColor) {
          runLen++
          if (runLen === 5) result += N1
          else if (runLen > 5) result++
        } else {
          addHistory(runLen, hist)
          if (!runColor) result += countPatterns(hist) * N3
          runColor = modules[y][x]
          runLen = 1
        }
      }
      result += terminate(runColor, runLen, hist) * N3
    }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x]
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1])
          result += N2
      }
    let dark = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++
    const total = size * size
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * N4
    return result
  }

  let bestMask = 0
  let minPenalty = Infinity
  for (let m = 0; m < 8; m++) {
    applyMask(m)
    drawFormat(m)
    const p = penalty()
    if (p < minPenalty) {
      minPenalty = p
      bestMask = m
    }
    applyMask(m) // undo
  }
  applyMask(bestMask)
  drawFormat(bestMask)
  return modules
}

/** SVG `<svg>` element for a QR of `text`, with a four-module quiet zone. */
export function qrSvg(text: string): string {
  let matrix: boolean[][]
  try {
    matrix = qrMatrix(text)
  } catch {
    // Beyond QR capacity: render a blank paper tile rather than break the studio.
    return dedent(`
      <svg class="wg-contact-card__qr-svg" viewBox="0 0 29 29" shape-rendering="crispEdges" role="img" aria-label="QR code unavailable">
        <rect class="wg-contact-card__qr-paper" width="29" height="29"></rect>
      </svg>
    `)
  }
  const n = matrix.length
  const quiet = 4
  const dim = n + quiet * 2
  let path = ''
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (matrix[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`
  return dedent(`
    <svg class="wg-contact-card__qr-svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">
      <rect class="wg-contact-card__qr-paper" width="${dim}" height="${dim}"></rect>
      <path class="wg-contact-card__qr-ink" d="${path}"></path>
    </svg>
  `)
}

export const contactCard: WidgetSpec = {
  id: 'contact-card',
  name: 'Contact Card',
  category: 'data',
  blurb: 'A business card showing a name, contact line and a scannable QR code.',
  tags: ['data', 'contact', 'qr', 'card'],
  frame: { w: 220, h: 252 },
  controls: [
    { key: 'name', label: 'Name', type: 'text', default: 'Avery Quinn' },
    { key: 'title', label: 'Title', type: 'text', default: 'Product Designer' },
    { key: 'contactInfo', label: 'Contact', type: 'text', default: 'avery@studio.co' },
    { key: 'qrTarget', label: 'QR target', type: 'text', default: 'https://widgetry.dev' },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => {
    const title = String(p.title).trim()
    return dedent(`
      <div class="wg-contact-card__card">
        <div class="wg-contact-card__head">
          <span class="wg-contact-card__chip"></span>
          <div class="wg-contact-card__id">
            <strong class="wg-contact-card__name">${esc(String(p.name))}</strong>
            ${title ? `<span class="wg-contact-card__title">${esc(title)}</span>` : ''}
          </div>
        </div>
        <div class="wg-contact-card__foot">
          <span class="wg-contact-card__contact">${esc(String(p.contactInfo))}</span>
          <span class="wg-contact-card__qr">${qrSvg(String(p.qrTarget))}</span>
        </div>
      </div>
    `)
  },
  css: () => dedent(`
    .wg-contact-card {
      width: 190px;
      height: 232px;
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-contact-card__card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      width: 100%;
      height: 100%;
      padding: 18px;
      border-radius: 24px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      box-shadow: 0 18px 40px -20px rgba(0, 0, 0, .55);
      overflow: hidden;
      box-sizing: border-box;
    }
    .wg-contact-card__head { display: flex; align-items: flex-start; gap: 12px; }
    .wg-contact-card__chip {
      width: 26px;
      height: 18px;
      border-radius: 4px;
      background: rgba(255, 255, 255, .45);
      flex: 0 0 auto;
      margin-top: 2px;
    }
    .wg-contact-card__id { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .wg-contact-card__name { font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
    .wg-contact-card__title { font-size: 11px; letter-spacing: .02em; color: var(--wg-accent); }
    .wg-contact-card__foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .wg-contact-card__contact { font-size: 11px; opacity: .6; word-break: break-all; min-width: 0; }
    .wg-contact-card__qr {
      width: 66px;
      height: 66px;
      flex: 0 0 auto;
      border-radius: 10px;
      background: #ffffff;
      padding: 6px;
      box-sizing: border-box;
    }
    .wg-contact-card__qr-svg { display: block; width: 100%; height: 100%; }
    .wg-contact-card__qr-paper { fill: #ffffff; }
    .wg-contact-card__qr-ink { fill: #0a0a0a; }
  `),
}
