import { dedent } from '../lib/util'

/**
 * The Markdown subset, authored once as a JavaScript source string.
 *
 * Widgetry's basis of trust is that the studio preview and the downloaded file run
 * byte-identical markup / css / script strings (docs/PRD.md 4.1). A widget that formats
 * visitor text at runtime threatens that: the obvious shape is a nice TypeScript renderer
 * for the preview and a hand-copied JavaScript one for the export, which is two
 * implementations of an escaping routine that are one edit away from disagreeing - and the
 * one that drifts is the one nobody is running locally.
 *
 * So there is exactly one implementation, and it lives here as text. MD_JS is what an export
 * embeds verbatim; renderMarkdown is that same text compiled with `new Function`, the way
 * `mount()` already compiles every widget script (src/lib/render.ts). Preview and export
 * cannot drift because there is nothing for them to drift from.
 *
 * ## The subset
 *
 * | Source            | Renders as                    |
 * | ----------------- | ----------------------------- |
 * | `# ` `## ` `### ` | `<h1>` `<h2>` `<h3>`          |
 * | `**bold**`        | `<strong>`                    |
 * | `*italic*`        | `<em>`                        |
 * | backtick span     | `<code>`                      |
 * | `[text](url)`     | `<a>`, `http(s):` / `mailto:` |
 * | `- item`          | `<ul><li>`                    |
 * | `1. item`         | `<ol><li>`                    |
 * | single newline    | `<br />` inside a `<p>`       |
 * | blank line        | new `<p>`                     |
 *
 * Everything else is text. Not "everything else is undefined" - text.
 *
 * ## Why it is safe
 *
 * Escape first, format second, and never the other way round. The whole input is
 * HTML-escaped before a single rule looks at it, so by the time formatting runs there is no
 * `<`, `>`, `"` or `&` left in the string to build an element out of. Every tag in the
 * output is one this file wrote. No sanitiser is needed on the way out because nothing
 * hostile survived the way in - which also keeps the export at zero dependencies (4.3).
 *
 * That ordering pays for the placeholder trick too. Finished fragments are parked behind a
 * `<<n>>` marker while later rules run, and the marker is unforgeable for the same reason:
 * a `<` typed by the visitor became `&lt;` before any of this started, so every `<` left in
 * the working string is one this file put there.
 *
 * URLs are the one place raw visitor text reaches an attribute, so they are allowlisted:
 * `http://`, `https://` and `mailto:` pass, everything else (`javascript:`, `data:`, and
 * whatever is invented next) fails the check and the link stays literal text. An allowlist,
 * not a denylist - reject unknown, accept known.
 *
 * Tags are emitted bare, with no class attributes. Scoping is the consuming widget's job
 * via `.wg-<id>__preview h1 { }`, which keeps AUTHORING.md Rule 2 intact without this file
 * having to know which widget mounted it.
 */
export const MD_JS: string = dedent(String.raw`
/* Widgetry Markdown - the single source behind the preview and every export. */

/**
 * A backtick cannot be written literally inside the authoring template that carries this
 * source, so the code-span pattern is assembled from its character code instead.
 */
var mdTick = String.fromCharCode(96);
var mdCodeRe = new RegExp(mdTick + '([^' + mdTick + '\\n]+)' + mdTick, 'g');

/** Markers parked by mdStash. Two angle brackets, which escaped input can never contain. */
var mdMarkRe = /<<(\d+)>>/;
var mdMarkAllRe = /<<(\d+)>>/g;

/** HTML-escape first. Matches esc() in src/lib/util.ts; attributes are double-quoted. */
function mdEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Park finished HTML behind a marker so later rules cannot reach inside it. A code span
 * holding '**not bold**' stays literal, and emphasis never rewrites an href.
 */
function mdStash(store, html) {
  store.push(html);
  return '<<' + (store.length - 1) + '>>';
}

/** Put the parked HTML back. Loops because a link label may itself hold a code span. */
function mdUnstash(s, store) {
  var out = String(s);
  var guard = 0;
  while (mdMarkRe.test(out) && guard++ < 100) {
    out = out.replace(mdMarkAllRe, function (whole, i) {
      var held = store[Number(i)];
      return held === undefined ? '' : held;
    });
  }
  return out;
}

/** Allowlist: the three schemes that can safely carry visitor text into an href. */
function mdUrl(raw) {
  var url = String(raw).trim();
  if (!url) return '';
  /*
   * Second layer. Escaping already makes a quote inert inside the double-quoted href, so
   * this is not the thing standing between a note and an injected handler - it is the thing
   * standing there if the escaping above is ever weakened. A quote or an angle bracket in a
   * URL is an attack or a typo; neither deserves an anchor.
   */
  if (/["<>]/.test(url) || /&quot;|&lt;|&gt;/.test(url)) return '';
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(url)) return url;
  return '';
}

/** '**bold**' then '*italic*', in that order, so '**' is consumed before '*' sees it. */
function mdEmphasis(s) {
  return String(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

/** Inline rules for one already-escaped line: code, then links, then emphasis. */
function mdInline(s, store) {
  var out = String(s).replace(mdCodeRe, function (whole, code) {
    return mdStash(store, '<code>' + code + '</code>');
  });
  out = out.replace(/(!?)\[([^\]\n]*)\]\(([^()\s]*)\)/g, function (whole, bang, label, url) {
    // '![alt](src)' is image syntax, which is outside the subset. Matching the '!' here and
    // bailing keeps the promise exact: what the subset does not name stays text, rather than
    // quietly degrading into a link to the image.
    if (bang) return whole;
    var href = mdUrl(url);
    if (!href) return whole;
    return mdStash(
      store,
      '<a href="' + href + '" rel="noopener noreferrer" target="_blank">' +
        mdEmphasis(label) +
        '</a>'
    );
  });
  return mdEmphasis(out);
}

/** Markdown source -> HTML string. The only entry point; everything above serves it. */
function mdRender(src) {
  var raw = src === null || src === undefined ? '' : String(src);
  var text = mdEscape(raw.replace(/\r\n?/g, '\n'));
  var lines = text.split('\n');
  var store = [];
  var html = [];
  var para = [];
  var list = '';
  var items = [];

  function flushPara() {
    if (!para.length) return;
    html.push('<p>' + para.join('<br />') + '</p>');
    para = [];
  }

  function flushList() {
    if (!list) return;
    html.push('<' + list + '>' + items.join('') + '</' + list + '>');
    list = '';
    items = [];
  }

  function openList(kind) {
    if (list !== kind) {
      flushList();
      list = kind;
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (!line) {
      flushPara();
      flushList();
      continue;
    }

    var heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      var level = heading[1].length;
      html.push('<h' + level + '>' + mdInline(heading[2].trim(), store) + '</h' + level + '>');
      continue;
    }

    var bullet = /^-\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      openList('ul');
      items.push('<li>' + mdInline(bullet[1].trim(), store) + '</li>');
      continue;
    }

    var ordered = /^\d{1,9}\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushPara();
      openList('ol');
      items.push('<li>' + mdInline(ordered[1].trim(), store) + '</li>');
      continue;
    }

    flushList();
    para.push(mdInline(line, store));
  }

  flushPara();
  flushList();
  return mdUnstash(html.join(''), store);
}
`)

/**
 * The entry point declared by MD_JS. Exported so a widget script that embeds the source
 * calls it by a name it did not have to remember, and a rename stays a one-line change here.
 */
export const MD_ENTRY = 'mdRender'

export type MarkdownRenderer = (src: string) => string

/**
 * Compile MD_JS into a callable. This is the derivation - the reason there is no second
 * implementation to keep in step - and it is the same `new Function` seam `mount()` uses to
 * run a widget script, so what runs here is what runs in the downloaded file.
 */
export function compileMarkdown(): MarkdownRenderer {
  // eslint-disable-next-line no-new-func
  return new Function('src', `${MD_JS}\nreturn ${MD_ENTRY}(src);`) as MarkdownRenderer
}

/** Compiled once; the source is a constant, so recompiling per call would buy nothing. */
let compiled: MarkdownRenderer | null = null

/** Render the Markdown subset to HTML. Pure, deterministic, safe against hostile input. */
export function renderMarkdown(src: string): string {
  if (!compiled) compiled = compileMarkdown()
  return compiled(src)
}
