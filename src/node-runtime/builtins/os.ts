import type { BuiltinSpec } from './types';

/** `os` builtin — static host facts for the browser sandbox. */
export const osSpec: BuiltinSpec = {
  id: 'os',
  aliases: ['node:os'],
  origin: 'web-node',
  init: () => ({
    EOL: '\n',
    devNull: '/dev/null',
    arch: () => 'wasm32',
    platform: () => 'linux',
    type: () => 'Browser',
    release: () => 'browser',
    version: () => 'web-node',
    machine: () => 'wasm32',
    hostname: () => 'web-node',
    endianness: () => 'LE',
    tmpdir: () => '/tmp',
    homedir: () => '/home/web-node',
    userInfo: () => ({ uid: 0, gid: 0, username: 'web-node', homedir: '/home/web-node', shell: null }),
    cpus: () => [],
    availableParallelism: () => navigator.hardwareConcurrency ?? 1,
    totalmem: () => 1024 * 1024 * 1024,
    freemem: () => 512 * 1024 * 1024,
    uptime: () => Math.floor(performance.now() / 1000),
    loadavg: () => [0, 0, 0],
    networkInterfaces: () => ({}),
    getPriority: () => 0,
    setPriority: () => undefined,
    constants: { UV_UDP_REUSEADDR: 4, errno: {}, signals: {}, priority: {} },
  }),
};
