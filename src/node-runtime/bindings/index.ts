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
  osBinding,
  performanceBinding,
  processMethodsBinding,
  symbolsBinding,
  taskQueueBinding,
  traceEventsBinding,
  uvBinding,
  streamWrapBinding,
} from './misc';
import { messagingBinding, workerBinding } from './messaging';
import { stringDecoderBinding } from './string_decoder';

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
  uv: uvBinding,
  stream_wrap: streamWrapBinding,
  diagnostics_channel: diagnosticsChannelBinding,
  task_queue: taskQueueBinding,
  trace_events: traceEventsBinding,
  inspector: inspectorBinding,
  async_wrap: asyncWrapBinding,
  async_context_frame: asyncContextFrameBinding,
  worker: workerBinding,
};

/** Bindings Node internal code knows about but that we deliberately do not ship. */
export const UNSUPPORTED_BINDINGS = new Set([
  'crypto',
  'zlib',
  'tcp_wrap',
  'udp_wrap',
  'pipe_wrap',
  'tty_wrap',
  'contextify',
  'module_wrap',
  'modules',
  'inspector',
  'sea',
  'ffi',
  'quic',
  'dtls',
  'cares_wrap',
  'http_parser',
  'encoding_binding',
  'blob',
  'url',
  'url_pattern',
  'trace_events',
  'heap_utils',
  'mksnapshot',
  'profiler',
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
