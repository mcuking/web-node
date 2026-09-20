import type { BindingContext, BindingFactory } from './context';

/**
 * `async_wrap` — the async-id bookkeeping that Node keeps in C++.
 *
 * In Node these are native `AliasedArray`s shared with V8; here the same
 * arrays are plain JS typed arrays, which is enough because the ids are only
 * ever read back through `internal/async_hooks`. The hook *invocation* stays in
 * JS (vendored `internal/async_hooks.js`), exactly like Node: the binding only
 * owns the counters, the context stack and the trampoline registration, then
 * forwards to `nativeHooks` via `setupHooks()`.
 */

// `Environment::AsyncHooks::Fields` (src/env.h) — indices into fields().
const kInit = 0;
const kBefore = 1;
const kAfter = 2;
const kDestroy = 3;
const kPromiseResolve = 4;
const kTotals = 5;
const kCheck = 6;
const kStackLength = 7;
const kUsesExecutionAsyncResource = 8;
const kFieldsCount = 9;

// `Environment::AsyncHooks::UidFields` (src/env.h) — indices into id_fields().
const kExecutionAsyncId = 0;
const kTriggerAsyncId = 1;
const kAsyncIdCounter = 2;
const kDefaultTriggerAsyncId = 3;
const kUidFieldsCount = 4;

// `Environment::kStackSize`: pairs of ids in `async_ids_stack`.
const kStackSize = 256;

/**
 * `AsyncWrap::ProviderType` names, in declaration order
 * (`NODE_ASYNC_PROVIDER_TYPES` in src/async_wrap.h). Read off a real Node first
 * — the numeric ids are ABI, not something we get to choose.
 */
const PROVIDERS: Record<string, number> = {
  NONE: 0,
  DIRHANDLE: 1,
  DNSCHANNEL: 2,
  ELDHISTOGRAM: 3,
  FILEHANDLE: 4,
  FILEHANDLECLOSEREQ: 5,
  BLOBREADER: 6,
  FSEVENTWRAP: 7,
  FSREQCALLBACK: 8,
  FSREQPROMISE: 9,
  GETADDRINFOREQWRAP: 10,
  GETNAMEINFOREQWRAP: 11,
  HEAPSNAPSHOT: 12,
  HTTP2SESSION: 13,
  HTTP2STREAM: 14,
  HTTP2PING: 15,
  HTTP2SETTINGS: 16,
  HTTPINCOMINGMESSAGE: 17,
  HTTPCLIENTREQUEST: 18,
  LOCKS: 19,
  DTLS_ENDPOINT: 20,
  DTLS_SESSION: 21,
  JSSTREAM: 22,
  JSUDPWRAP: 23,
  MESSAGEPORT: 24,
  PIPECONNECTWRAP: 25,
  PIPESERVERWRAP: 26,
  PIPEWRAP: 27,
  PROCESSWRAP: 28,
  PROMISE: 29,
  QUERYWRAP: 30,
  QUIC_ENDPOINT: 31,
  QUIC_LOGSTREAM: 32,
  QUIC_SESSION: 33,
  QUIC_STREAM: 34,
  QUIC_UDP: 35,
  SHUTDOWNWRAP: 36,
  SIGNALWRAP: 37,
  STATWATCHER: 38,
  STREAMPIPE: 39,
  TCPCONNECTWRAP: 40,
  TCPSERVERWRAP: 41,
  TCPWRAP: 42,
  TTYWRAP: 43,
  UDPSENDWRAP: 44,
  UDPWRAP: 45,
  SIGINTWATCHDOG: 46,
  WORKER: 47,
  WORKERCPUPROFILE: 48,
  WORKERCPUUSAGE: 49,
  WORKERHEAPPROFILE: 50,
  WORKERHEAPSNAPSHOT: 51,
  WORKERHEAPSTATISTICS: 52,
  WRITEWRAP: 53,
  ZLIB: 54,
  CHECKPRIMEREQUEST: 55,
  PBKDF2REQUEST: 56,
  KEYPAIRGENREQUEST: 57,
  KEYGENREQUEST: 58,
  KEYEXPORTREQUEST: 59,
  ARGON2REQUEST: 60,
  CIPHERREQUEST: 61,
  DERIVEBITSREQUEST: 62,
  HASHREQUEST: 63,
  RANDOMBYTESREQUEST: 64,
  RANDOMPRIMEREQUEST: 65,
  SCRYPTREQUEST: 66,
  SIGNREQUEST: 67,
  TLSWRAP: 68,
  VERIFYREQUEST: 69,
};

/** The JS-side hooks `internal/async_hooks` hands back via `setupHooks()`. */
interface NativeHooks {
  init?: (asyncId: number, type: string, triggerAsyncId: number, resource: unknown, isPromiseHook?: boolean) => void;
  before?: (asyncId: number) => void;
  after?: (asyncId: number) => void;
  destroy?: (asyncId: number) => void;
  promise_resolve?: (asyncId: number) => void;
}

export const asyncWrapBinding: BindingFactory = (ctx: BindingContext) => {
  const fields = new Uint32Array(kFieldsCount);
  const idFields = new Float64Array(kUidFieldsCount);
  const asyncIdsStack = new Float64Array(kStackSize * 2);
  const executionResources: unknown[] = [];

  // `AsyncHooks::AsyncHooks()` (src/env.cc): always run async_hooks checks, the
  // default trigger is "unset" (-1), and the counter starts at 1 so the first
  // user resource gets id 2 and bootstrap itself is id 1.
  fields[kCheck] = 1;
  idFields[kExecutionAsyncId] = 1;
  idFields[kTriggerAsyncId] = 0;
  idFields[kAsyncIdCounter] = 1;
  idFields[kDefaultTriggerAsyncId] = -1;

  let hooks: NativeHooks = {};
  let trampoline: ((...args: unknown[]) => unknown) | null = null;
  // Fallback stack, used only if the fixed `async_ids_stack` overflows.
  const overflow: number[] = [];

  // `registerDestroyHook` in Node keeps the resource alive just long enough to
  // emit `destroy`; a FinalizationRegistry is the JS-side equivalent.
  const registry =
    typeof FinalizationRegistry === 'function'
      ? new FinalizationRegistry<number>((asyncId) => {
          hooks.destroy?.(asyncId);
        })
      : null;

  const binding: Record<string, unknown> = {
    constants: {
      kInit,
      kBefore,
      kAfter,
      kDestroy,
      kPromiseResolve,
      kTotals,
      kCheck,
      kStackLength,
      kUsesExecutionAsyncResource,
      kFieldsCount,
      kExecutionAsyncId,
      kTriggerAsyncId,
      kAsyncIdCounter,
      kDefaultTriggerAsyncId,
      kUidFieldsCount,
    },
    async_hook_fields: fields,
    async_id_fields: idFields,
    async_ids_stack: asyncIdsStack,
    execution_async_resources: executionResources,
    Providers: PROVIDERS,
    asyncWrapProviders: PROVIDERS,

    /** `internal/bootstrap/node.js`: `setupHooks(nativeHooks)`. */
    setupHooks: (nativeHooks: NativeHooks) => {
      hooks = nativeHooks;
    },

    setCallbackTrampoline: (fn?: (...args: unknown[]) => unknown) => {
      trampoline = fn ?? null;
    },

    /**
     * We do not instrument V8 promises, so the promise hooks never fire. The
     * registration is kept real (it is what `internal/promise_hooks` expects)
     * and returns a working "stop" function.
     */
    setPromiseHooks: () => () => undefined,

    queueDestroyAsyncId: (asyncId: number) => {
      ctx.nextTick(() => hooks.destroy?.(asyncId));
    },

    registerDestroyHook: (resource: unknown, asyncId: number) => {
      if (registry && typeof resource === 'object' && resource !== null) {
        registry.register(resource, asyncId);
      }
    },

    clearAsyncIdStack: () => {
      fields[kStackLength] = 0;
      idFields[kExecutionAsyncId] = 0;
      idFields[kTriggerAsyncId] = 0;
      executionResources.length = 0;
      overflow.length = 0;
    },

    /**
     * The native fast path `internal/async_hooks` mirrors in JS. We still
     * provide it (Node's real binding has it) and use it as the overflow path.
     */
    pushAsyncContext: (asyncId: number, triggerAsyncId: number) => {
      overflow.push(idFields[kExecutionAsyncId], idFields[kTriggerAsyncId]);
      idFields[kExecutionAsyncId] = asyncId;
      idFields[kTriggerAsyncId] = triggerAsyncId;
    },
    popAsyncContext: () => {
      const trigger = overflow.pop();
      const execution = overflow.pop();
      if (execution !== undefined) idFields[kExecutionAsyncId] = execution;
      if (trigger !== undefined) idFields[kTriggerAsyncId] = trigger;
      return false;
    },
    /** Resources created on the JS side live in `execution_async_resources`. */
    executionAsyncResource: () => undefined,
  };

  return binding;
};
