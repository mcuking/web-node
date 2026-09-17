import type { BuiltinSpec } from './types';

import {
  internalErrorsSpec,
  internalFsGlobSpec,
  internalUtilSpec,
  internalValidatorsSpec,
} from './internal-shims';
import { vendoredBuiltins } from './vendored-builtins';
import { bufferSpec } from './buffer';
import { eventsSpec } from './events';
import { fsSpec } from './fs';
import { utilSpec } from './util';
import { consoleSpec } from './console';
import { timersSpec } from './timers';
import { processSpec } from './process';
import { stringDecoderSpec } from './string_decoder';
import { osSpec } from './os';
import { assertSpec } from './assert-impl';
import { moduleSpec } from './module';
import { netSpec } from './net';
import { httpSpec } from './http';

/** Every builtin the runtime knows about, in dependency-friendly order. */
export const ALL_BUILTINS: BuiltinSpec[] = [
  // internal shims
  internalErrorsSpec,
  internalValidatorsSpec,
  internalUtilSpec,
  internalFsGlobSpec,
  // vendored real Node source
  ...vendoredBuiltins,
  // our implementations
  bufferSpec,
  eventsSpec,
  utilSpec,
  consoleSpec,
  timersSpec,
  processSpec,
  stringDecoderSpec,
  osSpec,
  assertSpec,
  moduleSpec,
  fsSpec,
  // milestone 3: networking
  netSpec,
  httpSpec,
];

/** Ids that are user-visible core modules (no `internal/` prefix). */
export const PUBLIC_BUILTIN_IDS = ALL_BUILTINS.filter((b) => !b.id.startsWith('internal/')).map((b) => b.id);

export type { BuiltinSpec } from './types';
