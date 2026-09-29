import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { codeMask } from '../src/node-runtime/loader/code-mask';

/**
 * Build-time comment stripper for the vendored Node.js sources.
 *
 * `vendor/node-lib/**` is imported as raw text (`?raw`) and compiled at runtime,
 * so every byte of it lands in the worker bundle *as a string* — the bundler's
 * minifier cannot touch it. Comments are ~23% of the payload (Node's lib is
 * heavily documented), and they cost twice: once in the decoded bundle and again
 * whenever the browser parses it.
 *
 * So we delete them — but carefully, because the whole point of shipping real
 * Node source is that stack traces point at real lines:
 *
 *   - **Line numbers are preserved exactly.** Every newline inside a comment is
 *     kept, so line N of the stripped file is line N of the original.
 *   - **Code columns are preserved.** Only comment text is removed, and it is
 *     always the *trailing* part of its line — so no code character moves.
 *   - **The leading licence block is kept.** The per-file MIT notice is part of
 *     the software's copyright notice; it stays.
 *   - **Token joining is impossible.** A comment with no newline is replaced by a
 *     single space (`a/**​/b` must not become `ab`); a multi-line comment is
 *     replaced by exactly its newlines, which is whitespace-equivalent (ASI sees
 *     the same line terminators as before).
 *
 * Finding comments is done with the loader's tokeniser (`codeMask`), never a
 * regex: `//` and `/*` inside strings, templates and regex literals must survive.
 */

/** Longest prefix of the file we still scan for a leading licence block. */
const LICENSE_SCAN = 4000;

/**
 * Comment spans, as `[start, end)` offsets into `src`. Only comments — strings,
 * template literals and regex literals are never reported.
 */
export function commentSpans(src: string): Array<[number, number]> {
  const comments: Array<[number, number]> = [];
  codeMask(src, { comments });
  return comments;
}

/**
 * The leading licence block, if the file opens with one. Node's lib files start
 * with a `// Copyright …` / `// Permission is hereby granted …` run.
 */
function licenseBlockEnd(src: string): number {
  const head = src.slice(0, LICENSE_SCAN);
  const lines = head.split('\n');
  let count = 0;
  while (count < lines.length && lines[count].startsWith('//')) count++;
  if (count === 0) return 0;
  const block = lines.slice(0, count).join('\n');
  if (!block.includes('Copyright') && !block.includes('Permission is hereby')) return 0;
  // Include the newline that terminates the last `//` line.
  return block.length + 1;
}

/**
 * Remove comments from a vendored source file, preserving line numbers, code
 * columns and the leading licence block.
 */
export function stripVendoredSource(src: string): string {
  const spans = commentSpans(src);
  if (spans.length === 0) return src;

  const licenceEnd = licenseBlockEnd(src);
  const out: string[] = [];
  let prev = 0;
  for (const [start, end] of spans) {
    if (start < licenceEnd) continue; // keep the copyright notice
    out.push(src.slice(prev, start));
    const body = src.slice(start, end);
    if (body.includes('\n')) {
      // Whitespace-equivalent: the same line terminators, nothing else.
      out.push('\n'.repeat(body.split('\n').length - 1));
    } else {
      // Keep the two neighbours apart (`a/**/b` is not `ab`).
      out.push(' ');
    }
    prev = end;
  }
  out.push(src.slice(prev));

  // Drop the now-orphaned indentation of comment-only lines, and trailing
  // whitespace. Blank lines become a bare newline: no code, no column impact.
  const text = out.join('');
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : line.replace(/\s+$/, '')))
    .join('\n');
}

const VENDORED_RAW = /(^|[/\\])vendor[/\\]node-lib[/\\].*\.js$/;

/**
 * Serve `vendor/node-lib/**\/*.js?raw` as a comment-stripped `export default`.
 *
 * `enforce: 'pre'` so this wins over Vite's own `?raw` handling; the pristine
 * files on disk are never modified (provenance in `vendor/node-lib/MANIFEST.json`
 * stays exact), only what the bundle ships.
 */
export function vendoredSourcePlugin(): Plugin {
  return {
    name: 'web-node:vendored-source',
    enforce: 'pre',
    load(id) {
      const query = id.indexOf('?');
      if (query === -1 || id.slice(query + 1) !== 'raw') return null;
      const file = id.slice(0, query);
      if (!VENDORED_RAW.test(file)) return null;
      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        return null; // not a real file — let Vite deal with it
      }
      return `export default ${JSON.stringify(stripVendoredSource(src))};`;
    },
  };
}

// ---------------------------------------------------------------------------
// Lazy vendored bundle (M107): keep the ~2.3 MB of source text out of the
// worker's own JS graph.
//
// Before this, `import.meta.glob(..., { eager: true })` inlined every file as a
// string literal in the 2.5 MB worker chunk, so the browser had to download,
// *parse* and compile 2.3 MB of JS before a single line of the runtime ran.
// Instead we emit the same (comment-stripped) sources as plain-text assets,
// preload the **core** one from the document head, and have the worker `fetch()` +
// JSON.parse it (and the **lazy** one in the background, M126). Same bytes, but
// the big payload downloads in parallel with the tiny worker bootstrap and never
// costs a JS parse.
// ---------------------------------------------------------------------------

/** Output path (relative to `dist/`) of the emitted core bundle (M126). */
export const VENDORED_CORE_FILE = 'assets/vendored-core.txt';

/** Output path (relative to `dist/`) of the emitted rest bundle (M126). */
export const VENDORED_REST_FILE = 'assets/vendored-rest.txt';

/**
 * The vendored files the *realm reads while it boots* (M126).
 *
 * `new NodeRuntime(...)` (which installs the globals) only ever touches these:
 * the primordials, the module-loader plumbing, and the handful of builtins that
 * `console` / `process` / `stream` pull in. Everything else — `fs`, `crypto`,
 * `http`, `node_modules` helpers, the web streams — is only read when user code
 * `require()`s it, which happens *after* `ready`.
 *
 * So the emitter ships the sources as two assets: this core set is preloaded and
 * awaited at boot, the rest is fetched at low priority in the background. The
 * realm can be built (and `ready` posted) as soon as core lands, which takes the
 * ~344 KB (gzip) source payload off the critical path down to ~119 KB.
 *
 * It is a **curated list, not a computed closure**: `test/vendored-tiers.test.ts`
 * rebuilds the boot set by instrumenting `VENDORED` and asserts it is a subset of
 * this list, so a new boot dependency fails the gate instead of shipping a
 * broken split. If that test names a file, add it here.
 */
export const CORE_VENDORED: readonly string[] = [
  'async_hooks.js',
  'buffer.js',
  'console.js',
  'diagnostics_channel.js',
  'events.js',
  'internal/abort_controller.js',
  'internal/assert.js',
  'internal/async_context_frame.js',
  'internal/async_hooks.js',
  'internal/blob.js',
  'internal/buffer.js',
  'internal/console/constructor.js',
  'internal/console/global.js',
  'internal/constants.js',
  'internal/event_target.js',
  'internal/file.js',
  'internal/fixed_queue.js',
  'internal/linkedlist.js',
  'internal/per_context/primordials.js',
  'internal/perf/utils.js',
  'internal/priority_queue.js',
  'internal/streams/add-abort-signal.js',
  'internal/streams/compose.js',
  'internal/streams/destroy.js',
  'internal/streams/duplex.js',
  'internal/streams/duplexpair.js',
  'internal/streams/end-of-stream.js',
  'internal/streams/from.js',
  'internal/streams/legacy.js',
  'internal/streams/operators.js',
  'internal/streams/passthrough.js',
  'internal/streams/pipeline.js',
  'internal/streams/readable.js',
  'internal/streams/state.js',
  'internal/streams/transform.js',
  'internal/streams/utils.js',
  'internal/streams/writable.js',
  'internal/timers.js',
  'internal/trace_events.js',
  'internal/util.js',
  'internal/util/colors.js',
  'internal/util/debuglog.js',
  'internal/util/inspect.js',
  'internal/util/types.js',
  'internal/v8/startup_snapshot.js',
  'internal/validators.js',
  'internal/webidl.js',
  'internal/worker/js_transferable.js',
  'stream.js',
  'stream/promises.js',
  'string_decoder.js',
  'timers.js',
  'util.js',
  'util/types.js',
] as const;

function walkSources(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, root, out);
    else if (entry.name.endsWith('.js')) out.push(relative(root, full).split(sep).join('/'));
  }
}

/**
 * Every vendored source, comment-stripped, keyed by `vendor/node-lib`-relative
 * path — exactly the key the `?raw` glob produces at runtime.
 */
export function collectVendoredSources(root = 'vendor/node-lib'): Record<string, string> {
  const rels: string[] = [];
  walkSources(root, root, rels);
  rels.sort();
  const map: Record<string, string> = {};
  for (const rel of rels) map[rel] = stripVendoredSource(readFileSync(join(root, rel), 'utf8'));
  return map;
}

/** The serialised bundle (a JSON object) as it is shipped and fetched. */
export function vendoredBundleText(root = 'vendor/node-lib'): string {
  return JSON.stringify(collectVendoredSources(root));
}

/**
 * Emit {@link VENDORED_ASSET_FILE} on build, serve it from the dev server, and
 * preload it from `index.html`. `url` is the absolute URL (base-prefixed) the
 * app and the worker fetch, already carrying a cache-busting content hash.
 */
/**
 * Split the vendored sources into the boot tier and the lazy tier (M126).
 *
 * `core` holds {@link CORE_VENDORED}; `rest` holds everything else. A listed core
 * file that is not on disk throws here, so a stale entry cannot silently shrink
 * the bundle.
 */
export function splitVendoredSources(root = 'vendor/node-lib'): {
  core: Record<string, string>;
  rest: Record<string, string>;
} {
  const all = collectVendoredSources(root);
  const core: Record<string, string> = {};
  const rest: Record<string, string> = {};
  const coreSet = new Set(CORE_VENDORED);
  for (const rel of CORE_VENDORED) {
    if (!(rel in all)) throw new Error(`CORE_VENDORED lists a file that is not vendored: ${rel}`);
  }
  for (const [rel, src] of Object.entries(all)) {
    if (coreSet.has(rel)) core[rel] = src;
    else rest[rel] = src;
  }
  return { core, rest };
}

/** The serialised (comment-stripped) core tier, as shipped and fetched. */
export function vendoredCoreText(root = 'vendor/node-lib'): string {
  return JSON.stringify(splitVendoredSources(root).core);
}

/** The serialised (comment-stripped) lazy tier, as shipped and fetched. */
export function vendoredRestText(root = 'vendor/node-lib'): string {
  return JSON.stringify(splitVendoredSources(root).rest);
}

/**
 * Emit the two vendored-source tiers, serve them from the dev server, and preload
 * **only the core tier** from `index.html` (M126) — the lazy tier is fetched by
 * the worker in the background, so it must not compete for the critical path.
 * Both URLs are base-prefixed and carry a cache-busting content hash.
 */
export function vendoredBundlePlugin(
  coreJson: string,
  restJson: string,
  coreUrl: string,
  restUrl: string,
): Plugin {
  const devFiles = new Map<string, string>([
    [coreUrl.split('?')[0], coreJson],
    [restUrl.split('?')[0], restJson],
  ]);
  return {
    name: 'web-node:vendored-bundle',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqUrl = ((req as unknown as { url?: string }).url || '').split('?')[0];
        const body = devFiles.get(reqUrl);
        if (body === undefined) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VENDORED_CORE_FILE, source: coreJson });
      this.emitFile({ type: 'asset', fileName: VENDORED_REST_FILE, source: restJson });
    },
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'preload', as: 'fetch', crossorigin: '', href: coreUrl },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
