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
};

/** Bindings Node internal code knows about but that we deliberately do not ship. */
export const UNSUPPORTED_BINDINGS = new Set([
  'crypto',
  'zlib',
  'tcp_wrap',
  'udp_wrap',
  'pipe_wrap',
  'module_wrap',
  'inspector',
  'sea',
  'ffi',
  'quic',
  'dtls',
  'cares_wrap',
  'http_parser',
  'trace_events',
  'builtins',
  'options',
  'sqlite',
  'vfs',
  'report',
  'permission',
  'webstorage',
  'block_list',
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
