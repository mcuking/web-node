#!/usr/bin/env node
/**
 * Build the emnapi **thread-child** bootstrap that web-node serves to real
 * `Worker`s (M125 · 第二增量).
 *
 * Why generated, not imported: the child is a *different realm* from the
 * runtime worker. A real browser `Worker` can only load a script by URL, and it
 * cannot resolve bare specifiers (`@napi-rs/wasm-runtime`, `@emnapi/core`, …).
 * So the child must be one self-contained ESM file. We produce it here with
 * esbuild from {@link ENTRY} and commit the result to `public/` — the same
 * "committed artifact + reproducible script" contract as `native/build.mjs`
 * (which likewise needs an external toolchain).
 *
 * The emnapi/napi-rs sources come from a *target project's* `node_modules`
 * (web-node does not depend on them; the package that uses wasi-threads does):
 *
 *     node tools/build-wasi-thread-child.mjs --from <dir-with-node_modules>
 *
 * `--from` may point at either a project root or a `node_modules` directory.
 * Without it we try the cwd's `node_modules`.
 *
 * Output: `public/wasi-thread-child.js` (minified, self-contained ESM).
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const ENTRY = join(here, 'emnapi-thread-child.entry.mjs');
const OUT = resolve(repoRoot, 'public/wasi-thread-child.js');

function parseFrom(argv) {
  const i = argv.indexOf('--from');
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value) throw new Error('--from needs a directory argument');
  return resolve(value);
}

/** Return a `node_modules` directory that can resolve `@napi-rs/wasm-runtime`. */
function resolveNodeModules(from) {
  const candidates = [];
  if (from) candidates.push(from, join(from, 'node_modules'));
  candidates.push(join(process.cwd(), 'node_modules'));

  for (const dir of candidates) {
    if (existsSync(join(dir, '@napi-rs/wasm-runtime/package.json'))) return dir;
  }
  throw new Error(
    'could not find @napi-rs/wasm-runtime. Pass --from <project-root-or-node_modules> ' +
      'pointing at a project that has it installed.',
  );
}

async function main() {
  const from = parseFrom(process.argv.slice(2));
  const nodeModules = resolveNodeModules(from);

  // esbuild is a (hoisted) transitive dep of the build toolchain; load it by path
  // so this script works without adding it to `dependencies`.
  const require = createRequire(join(repoRoot, 'package.json'));
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch {
    esbuild = require(join(repoRoot, 'node_modules/esbuild'));
  }

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    nodePaths: [nodeModules],
    write: false,
    logLevel: 'warning',
  });

  const code = result.outputFiles[0].text;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, code);

  const raw = statSync(OUT).size;
  const gz = gzipSync(code).length;
  const rel = OUT.slice(repoRoot.length + 1);
  console.log(`wrote ${rel} — ${raw} bytes (gzip ${gz})`);
  console.log(`from node_modules: ${nodeModules}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
