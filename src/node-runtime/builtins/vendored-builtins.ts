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
