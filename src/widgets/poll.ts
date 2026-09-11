import type { WidgetSpec } from '../lib/types'
import { dedent, esc } from '../lib/util'

/**
 * Poll — the embed a reader votes in.
 *
 * Every other widget in this catalog is a pure function of its props. This one
 * is too, with one addition the product spec asks for by name: when the card
 * carries a poll id, `script` fetches the tally from the poll API and re-renders
 * from the response. The endpoint is not compiled in — it arrives as
 * `--wg-poll-api`, a CSS custom property on the root element like every other
 * token, so pointing an exported `poll.html` at your own host is a restyle
 * rather than a code edit.
 *
 * Two modes, one structure:
 *   - **preview** (no poll id): the tally in `tally` is the tally. A click moves
 *     it in the page and nowhere else, so the gallery tile is a live vote rather
 *     than a screenshot, and the studio can show every state without a server.
 *   - **live** (poll id set): the server owns the numbers. `percent` is used
 *     exactly as it arrives — the store already rounds a tally to whole
 *     percentages that sum to 100, and rounding a rounded number is how a bar
 *     chart ends up summing to 99.
 *
 * The script never builds a row out of a template string. It clones the row the
 * markup already rendered and fills it with `textContent`, so there is one
 * structure, authored once, and a label that arrives from the network cannot be
 * read as HTML.
 */

/** Matches the store: a poll is one question and between two and five options. */
const MIN_OPTIONS = 2
const MAX_OPTIONS = 5

/** Where the API lives when the author does not say. Same origin, same server. */
const DEFAULT_API = '/api/polls'

/**
 * The embed's own copy, in one place.
 *
 * Everything a *refused* request says comes from the server's `message` field,
 * displayed exactly as it arrives — the API owns that wording, and a second copy
 * of it here would be the one that goes stale. What is left is what the server
 * never gets to say: the states below happen when there is no response at all,
 * or no server to ask.
 */
const COPY = {
  promise: 'One vote per browser.',
  preview: 'Preview — this tally lives in the page, not on a server.',
  empty: 'No votes yet.',
  loading: 'Reading the tally…',
  loadFailed:
    'The tally could not be reached, so these are the options this page was published with, not the live count.',
  voteFailed: 'That vote did not reach the server, so nothing was counted. Try again in a moment.',
} as const

function splitList(raw: string, max: number): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
}

/** Preview counts, one per option, missing entries read as zero. */
function tallyFor(raw: string, count: number): number[] {
  const parsed = splitList(raw, count).map((n) => {
    const value = Number(n)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  })
  return Array.from({ length: count }, (_, i) => parsed[i] ?? 0)
}

/**
 * Whole percentages that sum to exactly 100 — largest remainder, ties broken by
 * option order, and all zeroes when nothing has been voted for yet.
 *
 * This mirrors `percentages()` in the poll store, and it is the one piece of
 * arithmetic that exists on both sides. It has to: preview mode has no server to
 * ask. Live mode never calls it — the server's `percent` is used verbatim — so
 * the two can only disagree about a tally no reader is looking at. The test
 * suite pins both to the same table of cases.
 */
function percentages(counts: number[]): number[] {
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (total <= 0) return counts.map(() => 0)

  const exact = counts.map((n) => (n * 100) / total)
  const result = exact.map(Math.floor)
  let remaining = 100 - result.reduce((sum, n) => sum + n, 0)

  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (let i = 0; remaining > 0; i += 1, remaining -= 1) {
    result[byRemainder[i % byRemainder.length].index] += 1
  }
  return result
}

/** `1 vote` / `12 votes`. The embed says the count in words, not just a bar. */
function voteLabel(total: number): string {
  return `${total} ${total === 1 ? 'vote' : 'votes'}`
}

export const poll: WidgetSpec = {
  id: 'poll',
  name: 'Poll Card',
  category: 'data',
  blurb: 'One question, up to five options, and bars that fill as the votes land.',
  tags: ['poll', 'vote', 'survey', 'results'],
  frame: { w: 360, h: 276 },
  interactive: true,
  controls: [
    {
      key: 'question',
      label: 'Question',
      type: 'text',
      default: 'Which export target do you reach for first?',
      maxLength: 200,
    },
    {
      key: 'options',
      label: 'Options',
      type: 'text',
      default: 'React,Web Component,Plain HTML',
      maxLength: 420,
    },
    { key: 'tally', label: 'Preview tally', type: 'text', default: '9,5,3' },
    { key: 'counts', label: 'Show vote counts', type: 'boolean', default: true },
    { key: 'pollId', label: 'Poll id', type: 'text', group: 'Server', default: '', maxLength: 64 },
    { key: 'api', label: 'API base', type: 'text', group: 'Server', default: DEFAULT_API, maxLength: 200 },
    {
      key: 'refresh',
      label: 'Re-read tally',
      type: 'number',
      group: 'Server',
      default: 8,
      min: 0,
      max: 60,
      step: 1,
      unit: 's',
    },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Bar', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
    /* The endpoint is a token: re-point the embed without opening its source. */
    '--wg-poll-api': String(p.api).trim() || DEFAULT_API,
  }),
  markup: (p) => {
    const id = String(p.pollId).trim()
    const live = id !== ''
    const labels = splitList(String(p.options), MAX_OPTIONS)
    /* A poll is never one-sided. Below the floor the card still renders, so the
       author sees the shape they are building rather than an error. */
    const options = labels.length >= MIN_OPTIONS ? labels : [...labels, 'Option']
    const counts = tallyFor(String(p.tally), options.length)
    const percents = percentages(counts)
    const total = counts.reduce((sum, n) => sum + n, 0)
    const showCounts = Boolean(p.counts)

    /* Live mode starts as `loading`: the numbers below are the author's, not the
       reader's, and saying so is the difference between "no votes yet" and
       "not read yet". Preview mode has nothing to wait for. */
    const state = live ? 'loading' : total > 0 ? 'voting' : 'empty'
    const foot = live ? COPY.loading : total > 0 ? COPY.promise : COPY.empty

    return dedent(`
      <p class="wg-poll__question" data-question>${esc(String(p.question))}</p>
      <ul class="wg-poll__list" role="radiogroup" aria-label="${esc(String(p.question))}"
          data-list data-poll="${esc(id)}" data-state="${state}"${showCounts ? '' : ' data-counts="off"'}>
        ${options
          .map(
            (label, i) => `<li class="wg-poll__option">
          <button class="wg-poll__choice" type="button" role="radio" aria-checked="false" data-option="o${i + 1}">
            <span class="wg-poll__fill" data-fill style="width: ${live ? 0 : percents[i]}%"></span>
            <span class="wg-poll__label" data-label>${esc(label)}</span>
            <span class="wg-poll__figure">
              <b class="wg-poll__count" data-count>${live ? '' : voteLabel(counts[i])}</b>
              <b class="wg-poll__percent" data-percent>${live ? '' : `${percents[i]}%`}</b>
            </span>
          </button>
        </li>`,
          )
          .join('')}
      </ul>
      <p class="wg-poll__foot">
        <span class="wg-poll__total" data-total>${live ? '' : voteLabel(total)}</span>
        <span class="wg-poll__note" data-note>${esc(foot)}</span>
      </p>
    `)
  },
  css: () => dedent(`
    .wg-poll {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 320px;
      padding: 18px;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-poll__question {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -.02em;
    }
    .wg-poll__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .wg-poll__choice {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 16px;
      border: 0;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      overflow: hidden;
      transition: background .3s ease;
    }
    .wg-poll__fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-accent) 35%, transparent);
      transition: width .35s cubic-bezier(.3, 1, .4, 1), background .3s ease;
    }
    .wg-poll__label,
    .wg-poll__figure {
      position: relative;
      z-index: 1;
    }
    .wg-poll__label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wg-poll__figure {
      display: flex;
      align-items: baseline;
      gap: 6px;
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 500;
    }
    .wg-poll__count { opacity: .55; font-weight: 500; }
    .wg-poll__percent { opacity: .7; font-weight: 600; font-variant-numeric: tabular-nums; }
    .wg-poll__list[data-counts="off"] .wg-poll__count { display: none; }
    .wg-poll__list[data-state="loading"] .wg-poll__figure { opacity: 0; }

    .wg-poll__choice:hover { background: color-mix(in srgb, var(--wg-ink) 20%, transparent); }
    .wg-poll__choice:focus-visible {
      outline: 2px solid var(--wg-accent);
      outline-offset: 2px;
    }
    /* Voted: the tally is settled, so the rows read rather than invite. */
    .wg-poll__list[data-state="voted"] .wg-poll__choice,
    .wg-poll__list[data-state="closed"] .wg-poll__choice { cursor: default; }
    .wg-poll__list[data-state="voted"] .wg-poll__choice:hover,
    .wg-poll__list[data-state="closed"] .wg-poll__choice:hover {
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
    }
    .wg-poll__choice[aria-checked="true"] .wg-poll__fill {
      background: var(--wg-accent);
    }
    .wg-poll__choice[aria-checked="true"] .wg-poll__count,
    .wg-poll__choice[aria-checked="true"] .wg-poll__percent { opacity: 1; }

    .wg-poll__foot {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin: 0;
      font-size: 12px;
      opacity: .55;
    }
    .wg-poll__total { font-weight: 600; font-variant-numeric: tabular-nums; }
    .wg-poll__note { flex: 1; }
    .wg-poll__foot[data-tone="alert"] { opacity: .7; }

    @media (prefers-reduced-motion: reduce) {
      .wg-poll__choice,
      .wg-poll__fill { transition: none; }
    }
  `),
  script: (p) => {
    const refreshMs = Math.max(0, Math.round(Number(p.refresh))) * 1000
    return dedent(`
      var list = root.querySelector('[data-list]');
      var question = root.querySelector('[data-question]');
      var totalOut = root.querySelector('[data-total]');
      var note = root.querySelector('[data-note]');
      var foot = note.parentElement;
      var pollId = list.getAttribute('data-poll') || '';
      var live = pollId !== '';
      var refreshMs = ${refreshMs};
      var copy = ${JSON.stringify(COPY)};

      /* One authored row. Every rendered row is a clone of it, so the markup
         above is the only place this structure exists. */
      var template = list.querySelector('.wg-poll__option').cloneNode(true);
      var timer = 0;
      var busy = false;
      var closed = false;
      var gone = false;

      /* The endpoint is a token on the root element, so a stylesheet can move
         this embed to another host without touching the script. */
      function token(name, fallback) {
        var value = '';
        try { value = getComputedStyle(root).getPropertyValue(name); } catch (e) { value = ''; }
        if (!value && root.style) value = root.style.getPropertyValue(name);
        value = String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\\/+$/, '');
        return value || fallback;
      }

      var api = token('--wg-poll-api', ${JSON.stringify(DEFAULT_API)});

      function label(total) {
        return total + (total === 1 ? ' vote' : ' votes');
      }

      function say(message, tone) {
        note.textContent = message;
        if (tone) foot.setAttribute('data-tone', tone);
        else foot.removeAttribute('data-tone');
      }

      /* Trust nothing that arrived over the wire: a response that is not a poll
         view leaves the rendered tally alone rather than blanking the card. */
      function usable(view) {
        if (!view || typeof view !== 'object') return false;
        if (typeof view.question !== 'string' || !Array.isArray(view.options)) return false;
        return view.options.length > 0;
      }

      function bar(option, votedId) {
        var li = template.cloneNode(true);
        var button = li.querySelector('[data-option]');
        var percent = Math.max(0, Math.min(100, Number(option.percent) || 0));
        var votes = Math.max(0, Number(option.votes) || 0);
        button.setAttribute('data-option', String(option.id));
        button.setAttribute('aria-checked', votedId && option.id === votedId ? 'true' : 'false');
        /* A settled poll still reads as a radio group, but one that no longer
           takes an answer — the same fact the click handler enforces. */
        button.setAttribute('aria-disabled', votedId ? 'true' : 'false');
        li.querySelector('[data-fill]').style.width = percent + '%';
        li.querySelector('[data-label]').textContent = String(option.label);
        li.querySelector('[data-count]').textContent = label(votes);
        li.querySelector('[data-percent]').textContent = percent + '%';
        return li;
      }

      /* The server's percentages are used as they arrive. They already sum to
         100; rounding them again is how a set of bars ends up summing to 99. */
      function render(view) {
        var voted = view.votedOptionId || null;
        question.textContent = view.question;
        list.setAttribute('aria-label', view.question);
        var next = document.createDocumentFragment();
        for (var i = 0; i < view.options.length; i += 1) {
          next.appendChild(bar(view.options[i], voted));
        }
        list.innerHTML = '';
        list.appendChild(next);
        list.setAttribute('data-state', voted ? 'voted' : view.totalVotes > 0 ? 'voting' : 'empty');
        totalOut.textContent = label(view.totalVotes || 0);
        closed = !!voted;
        root.dispatchEvent(new CustomEvent('wg:poll', {
          detail: { id: view.id || pollId, totalVotes: view.totalVotes || 0, votedOptionId: voted },
          bubbles: true
        }));
      }

      function settled(view, message, tone) {
        if (gone) return;
        if (usable(view)) render(view);
        if (message) say(message, tone);
        else if (closed) say(copy.promise);
        else if (list.getAttribute('data-state') === 'empty') say(copy.empty);
        else say(copy.promise);
      }

      /* One reader for every response: the body is read either way, because a
         refusal carries the sentence this card is going to display. */
      function send(path, init) {
        return fetch(api + path, init).then(function (res) {
          return res.json().catch(function () { return null; }).then(function (body) {
            return { ok: res.ok, status: res.status, body: body };
          });
        });
      }

      function load() {
        if (!live || gone) return Promise.resolve();
        return send('/' + encodeURIComponent(pollId), {
          credentials: 'same-origin',
          headers: { 'Accept': 'application/json' }
        }).then(function (res) {
          if (res.ok) settled(res.body);
          else settled(null, res.body && res.body.message ? res.body.message : copy.loadFailed, 'alert');
        }).catch(function () {
          if (!gone) say(copy.loadFailed, 'alert');
        });
      }

      /* Preview mode keeps the tally in the page: the tile in the gallery is a
         vote you can actually cast, and the studio can show every state without
         a server behind it. */
      function previewVote(optionId) {
        var rows = Array.prototype.slice.call(list.querySelectorAll('[data-option]'));
        var counts = rows.map(function (button) {
          var read = parseInt(button.querySelector('[data-count]').textContent, 10);
          return isNaN(read) ? 0 : read;
        });
        var index = rows.map(function (b) { return b.getAttribute('data-option'); }).indexOf(optionId);
        if (index < 0) return;
        counts[index] += 1;
        render({
          question: question.textContent,
          totalVotes: counts.reduce(function (sum, n) { return sum + n; }, 0),
          votedOptionId: optionId,
          options: rows.map(function (button, i) {
            return {
              id: button.getAttribute('data-option'),
              label: button.querySelector('[data-label]').textContent,
              votes: counts[i],
              percent: 0
            };
          })
        });
        applyPercents(counts);
        say(copy.preview);
      }

      /* Largest remainder, the same rule the server applies, so a preview tally
         and a live one are read the same way. */
      function applyPercents(counts) {
        var total = counts.reduce(function (sum, n) { return sum + n; }, 0);
        var result = counts.map(function () { return 0; });
        if (total > 0) {
          var exact = counts.map(function (n) { return (n * 100) / total; });
          result = exact.map(Math.floor);
          var remaining = 100 - result.reduce(function (sum, n) { return sum + n; }, 0);
          var order = exact
            .map(function (value, index) { return { index: index, fraction: value - Math.floor(value) }; })
            .sort(function (a, b) { return b.fraction - a.fraction || a.index - b.index; });
          for (var i = 0; remaining > 0; i += 1, remaining -= 1) {
            result[order[i % order.length].index] += 1;
          }
        }
        var fills = list.querySelectorAll('[data-fill]');
        var labels = list.querySelectorAll('[data-percent]');
        for (var j = 0; j < result.length; j += 1) {
          fills[j].style.width = result[j] + '%';
          labels[j].textContent = result[j] + '%';
        }
      }

      function vote(optionId) {
        if (busy || closed) return;
        if (!live) { previewVote(optionId); return; }
        busy = true;
        send('/' + encodeURIComponent(pollId) + '/vote', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ optionId: optionId })
        }).then(function (res) {
          if (res.ok) { settled(res.body); return; }
          var message = res.body && res.body.message ? res.body.message : copy.voteFailed;
          /* A refusal that names the option this browser already chose is worth
             a re-read: the reader gets the standing tally with their own vote
             marked, not just a sentence telling them it exists. */
          if (res.status === 409) return load().then(function () { say(message, 'alert'); });
          say(message, 'alert');
        }).catch(function () {
          if (!gone) say(copy.voteFailed, 'alert');
        }).then(function () { busy = false; });
      }

      function click(event) {
        var button = event.target.closest('[data-option]');
        if (button) vote(button.getAttribute('data-option'));
      }

      list.addEventListener('click', click);

      if (live) {
        load();
        if (refreshMs > 0) {
          timer = setInterval(function () {
            /* A hidden tab is not being read, so it does not need re-reading. */
            if (!document.hidden && !busy) load();
          }, refreshMs);
        }
      } else {
        say(list.getAttribute('data-state') === 'empty' ? copy.empty : copy.promise);
      }

      return function () {
        gone = true;
        if (timer) clearInterval(timer);
        list.removeEventListener('click', click);
      };
    `)
  },
}
