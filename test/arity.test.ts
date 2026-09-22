import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 72: exported `Function.length` parity. Feature detection reads
 * `fn.length` to probe optional arguments; our rest-parameter implementations
 * would report 0. We align them by redefining the (configurable) `length`
 * property. Expected values are captured from real Node v26.9.0.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const req = (id: string) => runtime.realm.require(id) as any;
  return { req };
}

const EXPECTED: Record<string, Record<string, number>> = {
  crypto: {
    Hash: 2, Hmac: 3, Sign: 2, Verify: 2, KeyObject: 2, DiffieHellman: 4, DiffieHellmanGroup: 1,
    ECDH: 1, X509Certificate: 1, createHash: 2, createHmac: 3, createSign: 2, createVerify: 2,
    createPrivateKey: 1, createPublicKey: 1, createSecretKey: 2, randomInt: 3, randomUUID: 1,
    scrypt: 4, scryptSync: 3, timingSafeEqual: 0, sign: 4, verify: 5, generateKey: 3,
    generateKeyPair: 3, generatePrime: 3, checkPrime: 1, argon2: 3, createMac: 3, setFips: 1,
  },
  http: {
    Agent: 1, ClientRequest: 3, Server: 2, ServerResponse: 2, IncomingMessage: 1,
    OutgoingMessage: 1, createServer: 2, get: 3, request: 3, validateHeaderName: 0,
    validateHeaderValue: 0,
  },
  https: { Agent: 1, Server: 2, createServer: 2, get: 3, request: 0 },
  net: { Server: 2, Socket: 1, Stream: 1, connect: 0, createConnection: 0, createServer: 2 },
  zlib: {
    BrotliCompress: 1, BrotliDecompress: 1, ZstdCompress: 1, ZstdDecompress: 1, ZipBuffer: 1,
    brotliCompress: 3, brotliCompressSync: 2, createBrotliCompress: 1, zstdCompress: 3,
    gzipSync: 2, deflateSync: 2, unzipSync: 2,
  },
  dns: { Resolver: 0, resolve: 3, resolveAny: 2, resolveMx: 2, resolveTxt: 2, setDefaultResultOrder: 1 },
  child_process: { ChildProcess: 0, fork: 1 },
  module: { register: 1, _resolveFilename: 4 },
  worker_threads: { moveMessagePortToContext: 0, postMessageToThread: 4 },
  perf_hooks: { importHistogram: 1 },
  v8: { queryObjects: 1 },
  console: { assert: 0, dir: 0, table: 0 },
};

describe('exported Function.length matches Node', () => {
  for (const [mod, names] of Object.entries(EXPECTED)) {
    it(`${mod}`, () => {
      const exports = boot().req(mod);
      for (const [name, len] of Object.entries(names)) {
        expect(typeof exports[name], `${mod}.${name} is a function`).toBe('function');
        expect(exports[name].length, `${mod}.${name}.length`).toBe(len);
      }
    });
  }

  it('process', () => {
    const { req } = boot();
    const process = req('process');
    for (const [name, len] of Object.entries({
      cpuUsage: 1, emitWarning: 4, kill: 2, umask: 1, reallyExit: 0, loadEnvFile: 0, ref: 1,
      unref: 1, execve: 1, setuid: 1,
    })) {
      expect(typeof process[name], `process.${name}`).toBe('function');
      expect(process[name].length, `process.${name}.length`).toBe(len);
    }
  });
});
