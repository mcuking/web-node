import type { BuiltinSpec } from './types';

import {
  internalAbortListenerSpec,
  internalEncodingSpec,
  internalErrorsSpec,
  internalErrorSourceSpec,
  internalHeapUtilsSpec,
  internalOptionsSpec,
  internalProcessPermissionSpec,
  internalStreamIterSpec,
  internalStreamIterTypesSpec,
  internalTraceSigintSpec,
  internalProcessTaskQueuesSpec,
  internalEventsSymbolsSpec,
  internalBootstrapRealmSpec,
  internalUrlSpec,
  internalFsRimrafSpec,
} from './internal-shims';
import { vendoredBuiltins } from './vendored-builtins';
import { vfsSpec } from './vfs';
import { undiciSpec } from './undici';
import { workerThreadsSpec } from './worker-threads';
import { cryptoSpec } from './crypto';
import { dnsSpec, dnsPromisesSpec } from './dns';
import { zlibSpec } from './zlib';
import { unsupportedSpecs } from './unsupported';
import { processSpec } from './process';
import { moduleSpec } from './module';
import { netSpec } from './net';
import { httpSpec } from './http';
import { httpsSpec } from './https';
import { tlsSpec } from './tls';
import { childProcessSpec } from './child_process';

/** Every builtin the runtime knows about, in dependency-friendly order. */
export const ALL_BUILTINS: BuiltinSpec[] = [
  // internal shims
  internalErrorsSpec,
  internalErrorSourceSpec,
  internalBootstrapRealmSpec,
  internalUrlSpec,
  internalFsRimrafSpec,
  internalHeapUtilsSpec,
  internalAbortListenerSpec,
  internalOptionsSpec,
  internalProcessPermissionSpec,
  internalEncodingSpec,
  internalTraceSigintSpec,
  internalProcessTaskQueuesSpec,
  internalEventsSymbolsSpec,
  internalStreamIterSpec,
  internalStreamIterTypesSpec,
  // vendored real Node source
  ...vendoredBuiltins,
  // milestone 49: Node's virtual file system module (MemoryProvider-backed)
  vfsSpec,
  // our implementations
  processSpec,
  moduleSpec,
  // milestone 3: networking
  netSpec,
  // milestone 4: streams (fs/http are built on these) — `stream`/`stream/promises`
  // are the vendored Node source (see vendored-builtins.ts), and `url` too
  cryptoSpec,
  dnsSpec,
  dnsPromisesSpec,
  zlibSpec,
  // `internal/deps/undici/undici` is a two-line shim: only
  // `createFastMessageEvent` is reachable from the vendored graph.
  undiciSpec,
  ...unsupportedSpecs,
  workerThreadsSpec,
  httpSpec,
  httpsSpec,
  tlsSpec,
  // milestone 7: the controlled spawn surface
  childProcessSpec,
];

/** Ids that are user-visible core modules (no `internal/` prefix). */
export const PUBLIC_BUILTIN_IDS = ALL_BUILTINS.filter((b) => !b.id.startsWith('internal/')).map((b) => b.id);

export type { BuiltinSpec } from './types';
