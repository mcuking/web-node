import type { BindingContext, BindingFactory, BindingTable } from './context';
import { notImplemented } from '../errors';

import { configBinding } from './config';
import { constantsBinding } from './constants';
import { typesBinding } from './types';
import { fsBinding } from './fs';
import { timersBinding } from './timers';
import { utilBinding } from './util';
import { bufferBinding } from './buffer';
import { asyncWrapBinding } from './async_wrap';
import {
  asyncContextFrameBinding,
  credentialsBinding,
  diagnosticsChannelBinding,
  errorsBinding,
  icuBinding,
  inspectorBinding,
  mksnapshotBinding,
  osBinding,
  performanceBinding,
  processMethodsBinding,
  symbolsBinding,
  taskQueueBinding,
  traceEventsBinding,
  uvBinding,
  fsDirBinding,
  fsEventWrapBinding,
  modulesBinding,
  streamWrapBinding,
  ttyWrapBinding,
} from './misc';
import { messagingBinding, workerBinding } from './messaging';
import { stringDecoderBinding } from './string_decoder';
import { blobBinding } from './blob';
import { urlBinding, urlPatternBinding, encodingBinding } from './url';
import { serdesBinding } from './serdes';
import { heapUtilsBinding, profilerBinding, v8Binding } from './v8';
import { contextifyBinding } from './contextify';
import { wnStubBinding } from './wn_stub';
import { zlibBinding } from './zlib';

/** The whitelist of internal bindings this runtime implements. */
const REGISTRY: Record<string, BindingFactory> = {
  config: configBinding,
  constants: constantsBinding,
  types: typesBinding,
  fs: fsBinding,
  timers: timersBinding,
  util: utilBinding,
  buffer: bufferBinding,
  symbols: symbolsBinding,
  errors: errorsBinding,
  performance: performanceBinding,
  process_methods: processMethodsBinding,
  os: osBinding,
  credentials: credentialsBinding,
  string_decoder: stringDecoderBinding,
  icu: icuBinding,
  messaging: messagingBinding,
  mksnapshot: mksnapshotBinding,
  uv: uvBinding,
  fs_dir: fsDirBinding,
  fs_event_wrap: fsEventWrapBinding,
  modules: modulesBinding,
  stream_wrap: streamWrapBinding,
  tty_wrap: ttyWrapBinding,
  blob: blobBinding,
  diagnostics_channel: diagnosticsChannelBinding,
  task_queue: taskQueueBinding,
  trace_events: traceEventsBinding,
  inspector: inspectorBinding,
  async_wrap: asyncWrapBinding,
  async_context_frame: asyncContextFrameBinding,
  worker: workerBinding,
  url: urlBinding,
  url_pattern: urlPatternBinding,
  encoding_binding: encodingBinding,
  serdes: serdesBinding,
  v8: v8Binding,
  heap_utils: heapUtilsBinding,
  profiler: profilerBinding,
  contextify: contextifyBinding,
  // native → WASM 接入缝的冒烟 binding（M115）：真 C 源码编 wasm 后经此接入。
  wn_stub: wnStubBinding,
  // 真 deps/zlib 编 wasm（M116）：deflate/gzip/inflate + 编解码参数。
  zlib: zlibBinding,
};

/**
 * Bindings Node's internal code knows about but that this runtime deliberately
 * does not ship. Every name here is a real `internalBinding` id used somewhere in
 * Node's `lib/`; the runtime has no equivalent for any of them (no libuv, no
 * sockets, no TLS record layer, no process spawning, no SQLite/FFI/WASI host).
 *
 * Registering one means deleting it from this list — the sets must stay
 * disjoint, which `test/bindings-surface.test.ts` enforces together with "every
 * name here is actually asked for by the vendored tree".
 */
export const UNSUPPORTED_BINDINGS = new Set([
  // Compilation / module machinery: there is no V8 compile cache or native
  // source text to hand out here.
  'builtins',
  'cjs_lexer',
  'internal_only_v8',
  'ipc_serdes',
  'module_wrap',
  'options',
  // Process control: no fork/exec/signals in a tab.
  'locks',
  'permission',
  'process_wrap',
  'report',
  'sea',
  'signal_wrap',
  'spawn_sync',
  'watchdog',
  // Sockets: `net`/`http` run on the virtual network instead of libuv handles.
  'cares_wrap',
  'http2',
  'http_parser',
  'js_stream',
  'pipe_wrap',
  'stream_pipe',
  'tcp_wrap',
  'udp_wrap',
  // TLS / QUIC / DTLS record layers.
  'dtls',
  'quic',
  'tls_wrap',
  // Host surfaces with no browser counterpart.
  'block_list',
  'crypto',
  'ffi',
  'sqlite',
  'wasi',
  'wasm_web_api',
  'webstorage',
]);

export function createBindingTable(ctx: BindingContext): BindingTable {
  const table: BindingTable = new Map();
  for (const [name, factory] of Object.entries(REGISTRY)) {
    // The table is passed in so a factory can read a sibling binding it must
    // agree with (see `BindingTable`). Names are registered in an order that
    // puts `symbols` first, but readers always resolve lazily, so order only
    // matters for what is present, not when it is read.
    table.set(name, factory(ctx, table));
  }
  return table;
}

export function hasBinding(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

export function listBindings(): { supported: string[]; unsupported: string[] } {
  return {
    supported: Object.keys(REGISTRY).sort(),
    unsupported: [...UNSUPPORTED_BINDINGS].sort(),
  };
}

export function unsupportedBinding(name: string): never {
  throw notImplemented(
    'binding',
    name,
    UNSUPPORTED_BINDINGS.has(name)
      ? 'It is explicitly outside the MVP whitelist. Milestones 3/4 add network and npm.'
      : undefined,
  );
}

export type { BindingContext } from './context';
