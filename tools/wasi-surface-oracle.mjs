// Dumps the surface of `node:wasi` from the real Node used as the oracle, so
// `test/wasi.test.ts` can diff web-node's implementation field by field.
//
//   node tools/wasi-surface-oracle.mjs > test/fixtures/wasi-surface.json
//
// Only the *shape* is captured here (names, arities, error codes); syscall
// behaviour is verified against fixtures elsewhere.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WASI } = require('node:wasi');

const protoOwnNames = Object.getOwnPropertyNames(WASI.prototype).sort();
const protoLengths = {};
for (const name of protoOwnNames) {
  if (typeof WASI.prototype[name] === 'function') protoLengths[name] = WASI.prototype[name].length;
}

const instance = new WASI({ version: 'preview1' });
const wasiImport = instance.wasiImport;
const wasiImportArity = {};
for (const name of Object.keys(wasiImport)) {
  if (typeof wasiImport[name] === 'function') wasiImportArity[name] = wasiImport[name].length;
}

const errorCode = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code ?? null;
  }
};

const report = {
  exportKeys: Object.keys(require('node:wasi')).sort(),
  WASI_name: WASI.name,
  WASI_length: WASI.length,
  protoOwnNames,
  protoLengths,
  instanceOwnKeys: Object.keys(instance).sort(),
  getImportObjectKeys: Object.keys(instance.getImportObject()).sort(),
  wasiImportKeys: Object.keys(wasiImport).sort(),
  wasiImportArity,
  errors: {
    noOptions: errorCode(() => new WASI()),
    noVersion: errorCode(() => new WASI({})),
    badVersion: errorCode(() => new WASI({ version: 'nope' })),
    badArgs: errorCode(() => new WASI({ version: 'preview1', args: 'x' })),
    badStdin: errorCode(() => new WASI({ version: 'preview1', stdin: -1 })),
  },
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
