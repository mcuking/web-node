// Differential observation program for M97 (`module` semantics). Runs unchanged
// on real Node v26.9.0 AND inside web-node; the emitted JSON must be equal.
//
// Covers: synchronous loader hooks (`module.registerHooks`), source-map
// registration + `findSourceMap`/`setSourceMapsSupport`, `findPackageJSON`, and
// a few `Module._*` internals. The throwaway base dir is normalised away
// (macOS resolves /var -> /private/var, so both spellings are stripped).
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('module');

const baseDir = path.join(os.tmpdir(), 'wnmh-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
fs.mkdirSync(baseDir, { recursive: true });
// The CJS loader realpaths module filenames, so make the base a realpath too —
// otherwise `findSourceMap`'s key would differ on macOS (/var vs /private/var).
const base = fs.realpathSync(baseDir);
fs.mkdirSync(base, { recursive: true });
fs.mkdirSync(base + '/node_modules/dep', { recursive: true });
fs.writeFileSync(base + '/node_modules/dep/package.json', '{"name":"dep","version":"1.0.0","main":"index.js"}');
fs.writeFileSync(base + '/node_modules/dep/index.js', 'module.exports = 1;');
fs.writeFileSync(base + '/a.js', 'module.exports = { hello: "world" };');
fs.writeFileSync(base + '/b.js', 'module.exports = { which: "orig" };');
fs.writeFileSync(base + '/c.js', 'module.exports = { which: "plain" };');
fs.writeFileSync(base + '/d.js', 'module.exports = { which: "d" };');

/** Replace the throwaway dir (and its /private-resolved twin) with <d>. */
const norm = (s) => String(s).split('/private' + base).join('<d>').split(base).join('<d>');

const out = {};
const shape = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, code: e.code ?? null, name: e.name, msg: norm(e.message) };
  }
};

// ---- registerHooks: returned shape ----
const seenResolve = [];
const seenLoad = [];
const h = M.registerHooks({
  resolve(spec, ctx, next) {
    seenResolve.push([spec, norm(ctx.parentURL), ctx.conditions.join(',')]);
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    seenLoad.push([norm(url), ctx.format ?? null]);
    return next(url, ctx);
  },
});
out.retKeys = Object.keys(h);
out.deregisterType = typeof h.deregister;

out.a = M._load(base + '/a.js', { filename: base + '/x.js' });
out.sawResolveForA = seenResolve.some(([s]) => s === base + '/a.js' || s === './a.js');
out.sawLoadForA = seenLoad.some(([u]) => u.endsWith('/a.js'));
out.resolveConditions = seenResolve.find(([, , c]) => c.includes('require'))?.[2] ?? null;
h.deregister();

// ---- registerHooks: short-circuit load ----
const h2 = M.registerHooks({
  load(url, ctx, next) {
    if (url.endsWith('/b.js')) {
      return { source: 'module.exports = { which: "patched" };', format: 'commonjs', shortCircuit: true };
    }
    return next(url, ctx);
  },
});
out.patched = M._load(base + '/b.js', { filename: base + '/x.js' });
h2.deregister();
// After deregister the plain file is loaded again under a fresh id.
out.unpatched = M._load(base + '/c.js', { filename: base + '/x.js' });

// ---- registerHooks: result without shortCircuit ----
// Use a fresh request + parent so Node's relativeResolveCache fast path (which
// skips hooks for an already-cached module) does not hide the error.
const h3 = M.registerHooks({
  resolve(spec, ctx) {
    return { url: spec };
  },
});
out.missingShortCircuit = shape(() => M._load(base + '/d.js', { filename: base + '/p2.js' }));
h3.deregister();

// ---- registerHooks: validation ----
out.noArg = shape(() => M.registerHooks());
out.badResolve = shape(() => M.registerHooks({ resolve: 3 }));

// ---- findPackageJSON ----
out.fpjDep = shape(() => norm(M.findPackageJSON('dep', base + '/x.js')));
out.fpjDepSub = shape(() => norm(M.findPackageJSON('dep/index.js', base + '/x.js')));
out.fpjMissing = shape(() => M.findPackageJSON('nope', base + '/x.js'));
out.fpjNoSpec = shape(() => M.findPackageJSON());

// ---- Module internals ----
out.nodeModulePaths = shape(() => M._nodeModulePaths('/a/b/c'));
out.findPathRel = shape(() => norm(M._findPath('./node_modules/dep/index.js', [base])));
out.findPathMissing = shape(() => M._findPath('./nope.js', [base]));
out.statFile = shape(() => M._stat(base + '/a.js'));
out.statDir = shape(() => M._stat(base));
out.statMissing = shape(() => M._stat(base + '/nope'));
out.resolveLookupPathsRel = shape(() => M._resolveLookupPaths('./x', { filename: base + '/a.js' }));
out.readPackage = shape(() => {
  const r = M._readPackage(base + '/node_modules/dep/index.js');
  return { type: r.type, exists: r.exists, pjsonPath: norm(r.pjsonPath) };
});

// ---- SourceMap surface ----
out.constants = shape(() => M.constants);
out.SourceMapName = M.SourceMap.name;
out.SourceMapLength = M.SourceMap.length;
out.defaultSupport = shape(() => M.getSourceMapsSupport());
out.setNonBool = shape(() => M.setSourceMapsSupport('x'));
out.newSourceMapNoArg = shape(() => new M.SourceMap());

// ---- source map registration + findSourceMap ----
const map = {
  version: 3,
  file: 'sm.js',
  sourceRoot: '',
  sources: ['sm.ts'],
  sourcesContent: ['export const x: number = 1;\n'],
  names: [],
  mappings: 'AAAA',
};
const inlineMap =
  '//# sourceMappingURL=data:application/json;base64,' +
  Buffer.from(JSON.stringify(map)).toString('base64');
fs.writeFileSync(
  base + '/sm.js',
  'exports.x = void 0;\nexports.x = 1;\n' + inlineMap + '\n',
);

M.setSourceMapsSupport(true);
out.supportAfterSet = shape(() => M.getSourceMapsSupport());
M._load(base + '/sm.js', { filename: base + '/x.js' });
const sm = M.findSourceMap(base + '/sm.js');
out.sm = sm
  ? {
      ctor: sm.constructor.name,
      ownKeys: Object.keys(sm),
      payloadKeys: Object.keys(sm.payload),
      lineLengthsLen: Array.isArray(sm.lineLengths) ? sm.lineLengths.length : null,
      entry: shapeFind(sm.findEntry(2, 0)),
      origin: shapeOrigin(sm.findOrigin(3, 1)),
    }
  : null;
out.findMissing = shape(() => M.findSourceMap(base + '/nope.js'));
out.findNonString = shape(() => M.findSourceMap(123));
out.findBuiltin = shape(() => M.findSourceMap('node:fs'));
M.setSourceMapsSupport(false);
out.supportAfterUnset = shape(() => M.getSourceMapsSupport());

function shapeFind(e) {
  return {
    generatedLine: e.generatedLine,
    generatedColumn: e.generatedColumn,
    originalSource: norm(e.originalSource),
    originalLine: e.originalLine,
    originalColumn: e.originalColumn,
  };
}
function shapeOrigin(o) {
  return {
    fileName: norm(o.fileName),
    lineNumber: o.lineNumber,
    columnNumber: o.columnNumber,
  };
}

console.log('__OBS__' + JSON.stringify(out));
