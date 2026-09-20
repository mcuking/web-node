import type { BuiltinSpec } from './types';

/**
 * Builtins backed by real Node.js source (see tools/vendor.mjs).
 * Provenance is recorded in vendor/node-lib/MANIFEST.json.
 */

export const vendoredBuiltins: BuiltinSpec[] = [
  {
    id: 'internal/constants',
    vendorPath: 'internal/constants.js',
    origin: 'node-source',
  },
  {
    id: 'internal/encoding/util',
    vendorPath: 'internal/encoding/util.js',
    origin: 'node-source',
  },
  {
    id: 'internal/querystring',
    vendorPath: 'internal/querystring.js',
    origin: 'node-source',
    deps: ['internal/errors'],
  },
  {
    id: 'internal/streams/state',
    vendorPath: 'internal/streams/state.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/validators'],
  },
  {
    id: 'internal/streams/from',
    vendorPath: 'internal/streams/from.js',
    origin: 'node-source',
    deps: ['buffer', 'internal/errors'],
  },
  {
    id: 'internal/streams/utils',
    vendorPath: 'internal/streams/utils.js',
    origin: 'node-source',
  },
  {
    id: 'internal/streams/destroy',
    vendorPath: 'internal/streams/destroy.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/streams/utils'],
  },
  {
    id: 'internal/streams/end-of-stream',
    vendorPath: 'internal/streams/end-of-stream.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/streams/utils',
      'internal/async_hooks',
      'internal/async_context_frame',
      'internal/events/abort_listener',
    ],
  },
  {
    id: 'internal/streams/legacy',
    vendorPath: 'internal/streams/legacy.js',
    origin: 'node-source',
    deps: ['events'],
  },
  {
    id: 'internal/streams/add-abort-signal',
    vendorPath: 'internal/streams/add-abort-signal.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/streams/utils',
      'internal/streams/end-of-stream',
      'internal/events/abort_listener',
    ],
  },
  {
    id: 'internal/fixed_queue',
    vendorPath: 'internal/fixed_queue.js',
    origin: 'node-source',
  },
  {
    id: 'internal/streams/readable',
    vendorPath: 'internal/streams/readable.js',
    origin: 'node-source',
    deps: [
      'events',
      'buffer',
      'string_decoder',
      'internal/errors',
      'internal/validators',
      'internal/options',
      'internal/util/debuglog',
      'internal/streams/legacy',
      'internal/streams/state',
      'internal/streams/utils',
      'internal/streams/destroy',
      'internal/streams/end-of-stream',
      'internal/streams/add-abort-signal',
      'internal/streams/from',
      'internal/fixed_queue',
    ],
  },
  {
    id: 'events',
    aliases: ['node:events'],
    vendorPath: 'events.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/util/inspect',
      'internal/validators',
      'internal/events/abort_listener',
      'internal/fixed_queue',
      'internal/events/symbols',
      'internal/event_target',
    ],
  },
  {
    id: 'path',
    aliases: ['node:path'],
    vendorPath: 'path.js',
    origin: 'node-source',
    deps: ['internal/constants', 'internal/validators', 'internal/util', 'internal/fs/glob'],
  },
  {
    id: 'querystring',
    aliases: ['node:querystring'],
    vendorPath: 'querystring.js',
    origin: 'node-source',
    deps: ['buffer', 'internal/querystring'],
  },
];
