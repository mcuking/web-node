// Vendors a curated subset of the real Node.js source tree into vendor/node-lib/.
//
// Only files that are genuinely reusable as-is (no `internalBinding`, or only bindings
// we already provide) are vendored. Everything else lives in src/node-runtime/builtins
// as our own implementation. A manifest records upstream revision + content hash so we
// can prove provenance and detect drift on upgrade.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NODE_SRC = process.env.NODE_SRC || '/Users/tangjianghong/Downloads/node';
const LIB = path.join(NODE_SRC, 'lib');
const OUT = path.resolve('vendor/node-lib');

// Curated allow-list. Every entry must be dependency-free, or depend only on
// shims we already provide (see src/node-runtime/builtins/internal/*).
const FILES = [
  'internal/per_context/primordials.js',
  'internal/per_context/domexception.js',
  'internal/per_context/messageport.js',
  'internal/constants.js',
  'internal/encoding/util.js',
  'internal/querystring.js',
  'internal/streams/state.js',
  'internal/streams/from.js',
  'internal/streams/utils.js',
  'internal/streams/destroy.js',
  'internal/streams/end-of-stream.js',
  'internal/streams/legacy.js',
  'internal/streams/add-abort-signal.js',
  'internal/streams/readable.js',
  'internal/streams/writable.js',
  'internal/streams/duplex.js',
  'internal/streams/transform.js',
  'internal/streams/passthrough.js',
  'internal/streams/pipeline.js',
  'internal/streams/compose.js',
  'internal/streams/operators.js',
  'internal/streams/duplexpair.js',
  'internal/streams/duplexify.js',
  'stream.js',
  'stream/promises.js',
  'internal/fixed_queue.js',
  'internal/async_hooks.js',
  'internal/promise_hooks.js',
  'internal/async_context_frame.js',
  'internal/async_local_storage/async_hooks.js',
  'internal/async_local_storage/run_scope.js',
  'async_hooks.js',
  'events.js',
  'path.js',
  'querystring.js',
  'punycode.js',
  'domain.js',
  'diagnostics_channel.js',
];

/**
 * Documented, minimal patches applied to vendored source.
 * Every patch is recorded in the manifest so provenance stays auditable.
 */
const PATCHES = {
  'internal/per_context/primordials.js': [
    {
      note: 'Skip intrinsics missing on this engine (Float16Array / Iterator) instead of throwing.',
      find: '  copyPropsRenamed(globalThis[name], primordials, name);',
      replace:
        '  // [web-node patch] skip intrinsics absent from the host engine\n' +
        '  if (globalThis[name] === undefined) return;\n' +
        '  copyPropsRenamed(globalThis[name], primordials, name);',
    },
    {
      note: 'Guard intrinsic-object copies against missing globals.',
      find:
        '  const original = globalThis[name];\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamed(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
      replace:
        '  // [web-node patch] skip intrinsics absent from the host engine\n' +
        '  const original = globalThis[name];\n' +
        '  if (original === undefined) return;\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamed(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
    },
    {
      note: 'Guard bound-intrinsic copies against missing globals.',
      find:
        '  const original = globalThis[name];\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamedBound(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
      replace:
        '  // [web-node patch] skip intrinsics absent from the host engine\n' +
        '  const original = globalThis[name];\n' +
        '  if (original === undefined) return;\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamedBound(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
    },
  ],
};

function upstreamRev() {
  try {
    return execFileSync('git', ['-C', NODE_SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const manifest = {
  generatedAt: new Date().toISOString(),
  nodeSource: NODE_SRC,
  nodeRevision: upstreamRev(),
  files: [],
};

for (const rel of FILES) {
  const src = path.join(LIB, rel);
  if (!fs.existsSync(src)) {
    console.error(`skip (missing): ${rel}`);
    continue;
  }
  const originalBuf = fs.readFileSync(src);
  let text = originalBuf.toString('utf8');
  const appliedPatches = [];
  for (const patch of PATCHES[rel] ?? []) {
    if (!text.includes(patch.find)) {
      console.error(`  !! patch did not apply (pattern missing): ${patch.note}`);
      process.exitCode = 1;
      continue;
    }
    text = text.replace(patch.find, patch.replace);
    appliedPatches.push(patch.note);
  }
  const buf = Buffer.from(text, 'utf8');
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);
  manifest.files.push({
    path: rel,
    sha256: sha256(buf),
    upstreamSha256: sha256(originalBuf),
    bytes: buf.length,
    patches: appliedPatches,
  });
  console.log(`vendored ${rel} (${buf.length} bytes, ${appliedPatches.length} patch(es))`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nmanifest written: ${manifest.files.length} files @ ${manifest.nodeRevision}`);
