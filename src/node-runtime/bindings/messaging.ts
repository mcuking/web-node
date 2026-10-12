import type { BindingContext, BindingFactory, BindingTable } from './context';
import { notImplemented } from '../errors';
import {
  type PortBridgeApi,
  type PortBridgeFrame,
  type PortBridgeMessageFrame,
} from '../../sync/port-bridge';

/**
 * `messaging` binding: `MessagePort` / `MessageChannel` / `BroadcastChannel`.
 *
 * In Node this is `src/node_messaging.cc` (~1800 lines of V8 serializer work) —
 * a `uv_async_t`-backed handle whose payloads go through V8's structured
 * serializer and whose ports can be entangled into a `SiblingGroup`. None of
 * that machinery exists here, so the binding reimplements the *observable*
 * contract in JS on top of the host's `structuredClone`, and
 * `internal/worker/io.js` runs unmodified on it, exactly as it runs on the C++
 * handle: the JS module mutates our prototype, installs `oninit`/`handle_onclose`
 * hooks, and drives delivery through `emitMessage`.
 *
 * What is modelled faithfully (each verified against Node v26.9.0):
 *   - entanglement: a `MessageChannel` is an anonymous two-member `SiblingGroup`;
 *     a `BroadcastChannel` joins the *named* group for its channel name;
 *   - buffering: messages posted before the receiver adds a listener are kept
 *     and delivered when it starts (Node's `receiving_messages_` gate);
 *   - the close handshake: closing one member removes it from the group and, for
 *     an anonymous group that drops to a single member, posts Node's empty
 *     "close message" to that member, which closes it too (both emit `close`);
 *   - transfers: a `MessagePort` in the transfer list is detached from the
 *     sender (its handle closes) and re-materialised as a fresh handle on the
 *     receiving side; references to it *inside* the message are follow those
 *     tokens;
 *   - the whole `DataCloneError` surface (`Found invalid value in transferList.`,
 *     `MessagePort in transfer list is already detached`, duplicates, the source
 *     port, and a nested-but-unlisted port).
 *
 * What is deliberately not modelled: `moveMessagePortToContext` (this runtime
 * has a single V8 context, so it is the identity), the native `MessageEvent`
 * `ports` payload for `structuredClone(signal)`-style `JSTransferable`s (the
 * host `structuredClone` has no `[kClone]` hook), and the libuv ref count — see
 * `ref`/`unref` below.
 */

/** One endpoint of a channel. Entangled endpoints live in the same `Group`. */
interface Endpoint {
  group: Group | null;
  /** Undelivered envelopes, in order (`MessagePortData::incoming_messages_`). */
  incoming: Envelope[];
  /** The handle currently owning this endpoint, or `null` while en route. */
  owner: PortObject | null;
  /** `MessagePort::receiving_messages_` — set by `start()`. */
  receiving: boolean;
  refed: boolean;
  /** A drain task is already queued for this endpoint. */
  scheduled: boolean;
  /**
   * Present when this endpoint is one half of a **cross-realm** link (M147
   * Phase C). `handle` marks a proxy whose real group lives in the peer realm;
   * `group` marks an endpoint whose group lives here, whose settled twin is a
   * proxy over there.
   */
  bridge?: Bridge;
}

/** One half of a cross-realm port link. */
interface Bridge {
  role: 'handle' | 'group';
  id: string;
}

/** A `SiblingGroup`: anonymous (2 ports) or named (`BroadcastChannel`). */
interface Group {
  name: string;
  members: Set<Endpoint>;
}

/** Per-handle state. The handle and the endpoint have independent lifetimes. */
interface Handle {
  endpoint: Endpoint | null;
  closed: boolean;
}

/** A token → endpoint pair carried by one message (a transferred port). */
interface TokenRef {
  token: string;
  endpoint: Endpoint;
}

type Envelope =
  | { kind: 'message'; data: unknown; tokens: TokenRef[] }
  | { kind: 'close' };

type PortObject = Record<string, unknown>;

/** Endpoint + handle books, keyed by the port object identity. */
const HANDLES = new WeakMap<object, Handle>();

/** A unique, structured-clone-survivable marker for a transferred port. */
const TOKEN_PREFIX = '\u0000web-node:message-port:';

export const messagingBinding: BindingFactory = (ctx: BindingContext, table: BindingTable) => {
  const errors = () =>
    (ctx.requireBuiltin?.('internal/errors') as {
      codes: Record<string, new (...args: unknown[]) => Error>;
    })?.codes;

  /** Symbols shared with `internal/worker/io.js` (see the `symbols` binding). */
  const symbol = (name: string): symbol => {
    const symbols = table.get('symbols') as Record<string, symbol> | undefined;
    const value = symbols?.[name];
    if (value === undefined) throw new Error(`messaging binding: missing symbol ${name}`);
    return value;
  };

  const code = (name: string, fallbackMessage: string): Error => {
    const Ctor = (errors() as Record<string, new (...a: unknown[]) => Error>)?.[name];
    if (Ctor === undefined) return new TypeError(fallbackMessage);
    return new Ctor();
  };

  /** `DOMException` with `name: 'DataCloneError'`, as `ThrowDataCloneException` does. */
  const dataCloneError = (message: string): never => {
    const DomException = (globalThis as { DOMException?: new (m?: string, n?: string) => Error })
      .DOMException;
    if (typeof DomException === 'function') throw new DomException(message, 'DataCloneError');
    const err = new Error(message) as Error & { name: string };
    err.name = 'DataCloneError';
    throw err;
  };

  const namedGroups = new Map<string, Group>();
  let tokenCounter = 0;

  // -- cross-realm bridge state (M147 Phase C) -------------------------------

  /** The outbound transport to the peer realm, or `null` until `connect()`. */
  let transport: ((frame: PortBridgeFrame) => void) | null = null;
  /** `id` → this realm's half of each cross-realm link. */
  const bridges = new Map<string, Endpoint>();
  /** A realm-unique prefix so the two realms never mint the same id. */
  const realmTag = Math.random().toString(36).slice(2, 8);
  let bridgeSeq = 0;
  const nextBridgeId = (): string => `${realmTag}-${bridgeSeq++}`;
  const sendBridge = (frame: PortBridgeFrame): void => transport?.(frame);

  const endpointOf = (port: unknown): Endpoint | null =>
    typeof port === 'object' && port !== null ? (HANDLES.get(port)?.endpoint ?? null) : null;

  const isPort = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && HANDLES.has(value);

  // -- the handle ------------------------------------------------------------

  /**
   * The binding's `MessagePort`. Node's constructor throws
   * (`MessagePort::New` → `THROW_ERR_CONSTRUCT_CALL_INVALID`); ports only come
   * out of `MessageChannel`/`broadcastChannel`, which is why the prototype — not
   * the constructor — is what `internal/worker/io.js` mutates.
   */
  class MessagePort {
    constructor() {
      const err = new TypeError('Constructor cannot be called') as Error & { code: string };
      err.code = 'ERR_CONSTRUCT_CALL_INVALID';
      throw err;
    }

    postMessage(value?: unknown, transferList?: unknown): boolean {
      if (arguments.length === 0) {
        const err = new TypeError('Not enough arguments to MessagePort.postMessage') as Error & {
          code: string;
        };
        err.code = 'ERR_MISSING_ARGS';
        throw err;
      }
      return dispatch(this as unknown as PortObject, value, transferList);
    }

    start(): void {
      const endpoint = endpointOf(this);
      if (endpoint === null) return;
      endpoint.receiving = true;
      trigger(endpoint);
    }

    close(callback?: unknown): void {
      if (typeof callback === 'function') {
        (this as unknown as { once?: (t: string, f: unknown) => void }).once?.('close', callback);
      }
      const handle = HANDLES.get(this as unknown as object);
      if (handle === undefined || handle.closed) return;
      // `HandleWrap::Close` defers the real teardown to the loop, and the
      // `close` event lands after the messages already in flight.
      ctx.timers.setTimeout(() => closeHandle(this as unknown as object), 0);
    }

    ref(): void {
      const handle = HANDLES.get(this as unknown as object);
      if (handle !== undefined && !handle.closed) handle.endpoint!.refed = true;
    }

    unref(): void {
      const handle = HANDLES.get(this as unknown as object);
      if (handle !== undefined && !handle.closed) handle.endpoint!.refed = false;
    }

    hasRef(): boolean {
      const endpoint = endpointOf(this);
      return endpoint !== null && endpoint.refed;
    }
  }

  // -- construction ----------------------------------------------------------

  function initHandle(port: PortObject, endpoint: Endpoint): void {
    HANDLES.set(port, { endpoint, closed: false });
    endpoint.owner = port;
    // `MessagePort::MessagePort` calls the wrap's `oninit` once it is built.
    const oninit = (port as Record<symbol, unknown>)[symbol('oninit')];
    if (typeof oninit === 'function') oninit.call(port);
  }

  function createPort(group: Group): PortObject {
    const port = Object.create(MessagePort.prototype) as PortObject;
    const endpoint: Endpoint = {
      group,
      incoming: [],
      owner: null,
      receiving: false,
      refed: false,
      scheduled: false,
    };
    group.members.add(endpoint);
    initHandle(port, endpoint);
    return port;
  }

  /** Re-materialise a transferred endpoint as a brand new handle. */
  function materialize(endpoint: Endpoint): PortObject {
    const port = Object.create(MessagePort.prototype) as PortObject;
    initHandle(port, endpoint);
    // Pending messages survived the trip; run them now (Node calls
    // `TriggerAsync()` when the new owner is installed).
    trigger(endpoint);
    return port;
  }

  function MessageChannel(this: PortObject): void {
    if (!(this instanceof MessageChannel)) {
      const err = new TypeError('Cannot call constructor without `new`') as Error & { code: string };
      err.code = 'ERR_CONSTRUCT_CALL_REQUIRED';
      throw err;
    }
    const group: Group = { name: '', members: new Set() };
    this.port1 = createPort(group);
    this.port2 = createPort(group);
  }

  function broadcastChannel(name: string): PortObject {
    let group = namedGroups.get(name);
    if (group === undefined) {
      group = { name, members: new Set() };
      namedGroups.set(name, group);
    }
    return createPort(group);
  }

  // -- delivery --------------------------------------------------------------

  let emitMessage: ((data: unknown, ports: unknown[], type: string) => void) | null = null;

  function emit(port: PortObject, data: unknown, ports: unknown[], type: string): void {
    if (emitMessage === null) {
      const module = ctx.requireBuiltin?.('internal/per_context/messageport') as {
        emitMessage: (this: unknown, data: unknown, ports: unknown[], type: string) => void;
      };
      emitMessage = module.emitMessage;
    }
    emitMessage.call(port, data, ports, type);
  }

  function trigger(endpoint: Endpoint): void {
    if (endpoint.owner === null || endpoint.scheduled || endpoint.incoming.length === 0) return;
    endpoint.scheduled = true;
    // One host macrotask stands in for "the uv_async_t fired": Node's
    // `TriggerAsync` + `OnMessage` is asynchronous for the same reason.
    ctx.timers.setTimeout(() => {
      endpoint.scheduled = false;
      run(endpoint, false);
    }, 0);
  }

  /**
   * `MessagePort::OnMessage`. With `force` (the binding's `drainMessagePort`)
   * the `receiving_messages_` gate is ignored; otherwise a message is only taken
   * while the port is started — except a close message, which is always handled.
   */
  function run(endpoint: Endpoint, force: boolean): void {
    while (endpoint.incoming.length > 0) {
      const envelope = endpoint.incoming[0];
      if (!force && envelope.kind !== 'close' && !endpoint.receiving) break;
      endpoint.incoming.shift();
      if (envelope.kind === 'close') {
        if (endpoint.owner !== null) closeHandle(endpoint.owner);
        break;
      }
      const port = endpoint.owner;
      if (port === null) break;
      const { message, ports } = deserialize(envelope);
      emit(port, message, ports, 'message');
    }
  }

  function deserialize(envelope: Envelope & { kind: 'message' }): {
    message: unknown;
    ports: unknown[];
  } {
    const ports = envelope.tokens.map((token) => materialize(token.endpoint));
    if (envelope.tokens.length === 0) return { message: envelope.data, ports };
    const byToken = new Map<string, unknown>();
    for (let i = 0; i < envelope.tokens.length; i++) byToken.set(envelope.tokens[i].token, ports[i]);
    return { message: restorePorts(envelope.data, byToken, new Map()), ports };
  }

  // -- teardown --------------------------------------------------------------

  /** `MessagePort::OnClose`: detach, then — unless the port is being
   * transferred — leave the sibling group. */
  function closeHandle(port: object, transfer = false): void {
    const handle = HANDLES.get(port);
    if (handle === undefined || handle.closed) return;
    handle.closed = true;
    const endpoint = handle.endpoint;
    handle.endpoint = null;
    if (endpoint !== null) {
      if (endpoint.owner === port) endpoint.owner = null;
      // A cross-realm proxy handle closing tells the peer its half is gone.
      const bridge = endpoint.bridge;
      if (!transfer && bridge !== undefined) {
        bridges.delete(bridge.id);
        endpoint.bridge = undefined;
        sendBridge({ __wnPort: 'close', id: bridge.id });
      }
      // On a transfer the endpoint is en route to the receiver and keeps its
      // group (`MessagePort::TransferForMessaging` moves `data_` out before
      // `OnClose` can disentangle it).
      if (!transfer && endpoint.group !== null) disentangle(endpoint);
    }
    const hook = (port as Record<symbol, unknown>)[symbol('handle_onclose')];
    if (typeof hook === 'function') (hook as (this: object) => void).call(port);
  }

  /** `SiblingGroup::Disentangle`, including the empty "close message". */
  function disentangle(endpoint: Endpoint): void {
    const group = endpoint.group;
    if (group === null) return;
    endpoint.group = null;
    group.members.delete(endpoint);
    // Leaving a cross-realm group tells the proxy over there to close.
    const bridge = endpoint.bridge;
    if (bridge !== undefined && bridge.role === 'group') {
      bridges.delete(bridge.id);
      endpoint.bridge = undefined;
      sendBridge({ __wnPort: 'close', id: bridge.id });
    }
    // The leaving port gets a close message too (harmless: it is detached).
    endpoint.incoming.push({ kind: 'close' });
    if (group.members.size === 1 && group.name === '') {
      // An anonymous group that is down to one port closes that port as well —
      // unless that port is a cross-realm proxy, which is told to close instead
      // (it has no owner here to receive a local close envelope).
      for (const sibling of group.members) {
        const siblingBridge = sibling.bridge;
        if (siblingBridge !== undefined && siblingBridge.role === 'group') {
          bridges.delete(siblingBridge.id);
          sibling.bridge = undefined;
          sendBridge({ __wnPort: 'close', id: siblingBridge.id });
          continue;
        }
        sibling.incoming.push({ kind: 'close' });
        trigger(sibling);
      }
    }
    if (group.members.size === 0 && group.name !== '') namedGroups.delete(group.name);
  }

  // -- posting ---------------------------------------------------------------

  function readTransferList(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;
    if (
      typeof value === 'object' &&
      typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function'
    ) {
      return [...(value as Iterable<unknown>)];
    }
    throw invalidArgType('transferList', 'Optional transferList argument must be an iterable');
  }

  function invalidArgType(name: string, message: string): Error {
    const err = new TypeError(message) as Error & { code: string };
    err.code = 'ERR_INVALID_ARG_TYPE';
    void name;
    return err;
  }

  /** Read + validate a transfer list into ports and buffers (shared by every send path). */
  function collectTransferList(
    source: PortObject | null,
    transferList: unknown,
  ): { ports: PortObject[]; buffers: ArrayBuffer[] } {
    const ports: PortObject[] = [];
    const buffers: ArrayBuffer[] = [];
    for (const entry of readTransferList(transferList)) {
      if (isPort(entry)) {
        if (source !== null && entry === source) dataCloneError('Transfer list contains source port');
        if (ports.includes(entry as PortObject)) {
          dataCloneError('Transfer list contains duplicate MessagePort');
        }
        const state = HANDLES.get(entry as object)!;
        if (state.closed || state.endpoint === null) {
          dataCloneError('MessagePort in transfer list is already detached');
        }
        ports.push(entry as PortObject);
      } else if (entry instanceof ArrayBuffer) {
        if (buffers.includes(entry)) dataCloneError('Transfer list contains duplicate ArrayBuffer');
        buffers.push(entry);
      } else {
        dataCloneError('Found invalid value in transferList.');
      }
    }
    return { ports, buffers };
  }

  /**
   * Serialise a message that will cross the boundary: mint a token per
   * transmitted port, substitute them into the payload, clone it, then hand each
   * transmitted port to the peer as the *group* half of a fresh link (which
   * detaches the local handle, exactly as an in-realm transfer does).
   */
  function buildCrossRealmMessage(
    value: unknown,
    ports: PortObject[],
    buffers: ArrayBuffer[],
  ): { data: unknown; tokens: Array<{ token: string; id: string }> } {
    const tokenOf = new Map<object, string>();
    const tokens: Array<{ token: string; id: string }> = [];
    for (const transferred of ports) {
      const token = `${TOKEN_PREFIX}${tokenCounter++}\u0000`;
      tokenOf.set(transferred, token);
      tokens.push({ token, id: nextBridgeId() });
    }
    const substituted = substitutePorts(value, tokenOf, new Map());
    const data = structuredCloneOf(substituted, buffers);
    for (let i = 0; i < ports.length; i++) exportGroupSide(ports[i], tokens[i].id);
    return { data, tokens };
  }

  /** Detach a local port's handle and register it as the group half of a link. */
  function exportGroupSide(port: PortObject, id: string): void {
    const endpoint = HANDLES.get(port)?.endpoint ?? null;
    if (endpoint === null) return;
    endpoint.bridge = { role: 'group', id };
    bridges.set(id, endpoint);
    // `MessagePort::TransferForMessaging`: the sender's handle is gone; the
    // endpoint keeps its group so it stays entangled with local siblings.
    closeHandle(port, true);
  }

  function dispatch(port: PortObject, value?: unknown, transferList?: unknown): boolean {
    const handle = HANDLES.get(port);
    const endpoint = handle?.endpoint ?? null;
    const { ports, buffers } = collectTransferList(port, transferList);

    // A proxy handle has no local group: its group lives in the peer realm, so
    // the whole post (and any transfers it carries) crosses the boundary.
    if (endpoint?.bridge?.role === 'handle') {
      const { data, tokens } = buildCrossRealmMessage(value, ports, buffers);
      sendBridge({ __wnPort: 'msg', id: endpoint.bridge.id, data, tokens });
      return true;
    }

    const group = endpoint?.group ?? null;
    const targets = group === null ? [] : [...group.members].filter((s) => s !== endpoint);
    const crossed = targets.filter((s) => s.bridge?.role === 'group');
    const local = targets.filter((s) => s.bridge?.role !== 'group');

    // A message carrying ports can only be handed to one destination; exporting
    // the same port into two realms at once has no faithful meaning.
    if (crossed.length > 0 && local.length > 0) {
      throw notImplemented(
        'api',
        'MessagePort.postMessage across realms',
        'Delivering one message to both a local and a cross-thread port is not supported (M147 Phase C).',
      );
    }
    if (ports.length > 0 && crossed.length > 1) {
      throw notImplemented(
        'api',
        'MessagePort.postMessage across realms',
        'Transferring a port to several cross-thread ports at once is not supported (M147 Phase C).',
      );
    }

    // Cross-realm delivery to a bridged sibling.
    if (crossed.length > 0) {
      const { data, tokens } = buildCrossRealmMessage(value, ports, buffers);
      for (const target of crossed) {
        sendBridge({ __wnPort: 'msg', id: (target.bridge as Bridge).id, data, tokens });
      }
      return true;
    }

    const tokens: TokenRef[] = [];
    const tokenOf = new Map<object, string>();
    for (const transferred of ports) {
      const token = `${TOKEN_PREFIX}${tokenCounter++}\u0000`;
      tokenOf.set(transferred, token);
      tokens.push({ token, endpoint: HANDLES.get(transferred)!.endpoint! });
    }

    // Serialization happens even for a closed port, so the transfer-list rules
    // above are enforced identically before and after teardown.
    const substituted = substitutePorts(value, tokenOf, new Map());
    const data = structuredCloneOf(substituted, buffers);

    if (handle === undefined || handle.closed || handle.endpoint === null) return true;

    for (const transferred of ports) {
      // `MessagePort::TransferForMessaging`: close the sender's handle and hand
      // the *endpoint* to the message. The endpoint keeps its group, so the
      // transferred port stays entangled with its original sibling.
      closeHandle(transferred, true);
    }

    const source = handle.endpoint;
    const sourceGroup = source.group;
    if (sourceGroup === null || sourceGroup.members.size === 0) return true;
    const envelope: Envelope = { kind: 'message', data, tokens };
    for (const sibling of [...sourceGroup.members]) {
      if (sibling === source) continue;
      // `SiblingGroup::Dispatch` drops the message for a target that is itself
      // one of the transferred ports (the channel to it is gone).
      if (tokens.some((token) => token.endpoint === sibling)) continue;
      sibling.incoming.push(envelope);
      trigger(sibling);
    }
    return true;
  }

  function structuredCloneOf(value: unknown, transfer: ArrayBuffer[]): unknown {
    const sc = (globalThis as { structuredClone?: (v: unknown, o?: unknown) => unknown })
      .structuredClone;
    if (typeof sc !== 'function') {
      throw invalidArgType('structuredClone', 'This host has no structuredClone.');
    }
    return sc(value, { transfer });
  }

  // -- structured-clone graph, port aware ------------------------------------

  /**
   * Copy `value` into a graph the host serializer can handle, replacing every
   * `MessagePort` with a token string. Only the container types the host cloner
   * traverses are walked; everything else is handed over as a leaf so the host
   * still owns DataCloneError reporting for it.
   */
  function substitutePorts(
    value: unknown,
    tokenOf: Map<object, string>,
    seen: Map<unknown, unknown>,
  ): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (isPort(value)) {
      const token = tokenOf.get(value);
      if (token === undefined) {
        dataCloneError(
          'Object that needs transfer was found in message but not listed in transferList',
        );
      }
      return token;
    }
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) out.push(substitutePorts(item, tokenOf, seen));
      return out;
    }
    if (value instanceof Map) {
      const out = new Map<unknown, unknown>();
      seen.set(value, out);
      for (const [k, v] of value) {
        out.set(substitutePorts(k, tokenOf, seen), substitutePorts(v, tokenOf, seen));
      }
      return out;
    }
    if (value instanceof Set) {
      const out = new Set<unknown>();
      seen.set(value, out);
      for (const item of value) out.add(substitutePorts(item, tokenOf, seen));
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      seen.set(value, out);
      for (const key of Object.keys(value)) {
        out[key] = substitutePorts((value as Record<string, unknown>)[key], tokenOf, seen);
      }
      return out;
    }
    return value;
  }

  /** Inverse of `substitutePorts` on the *cloned* graph. */
  function restorePorts(
    value: unknown,
    byToken: Map<string, unknown>,
    seen: Map<unknown, unknown>,
  ): unknown {
    if (typeof value === 'string') return byToken.get(value) ?? value;
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) out.push(restorePorts(item, byToken, seen));
      return out;
    }
    if (value instanceof Map) {
      const out = new Map<unknown, unknown>();
      seen.set(value, out);
      for (const [k, v] of value) out.set(restorePorts(k, byToken, seen), restorePorts(v, byToken, seen));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set<unknown>();
      seen.set(value, out);
      for (const item of value) out.add(restorePorts(item, byToken, seen));
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      seen.set(value, out);
      for (const key of Object.keys(value)) {
        out[key] = restorePorts((value as Record<string, unknown>)[key], byToken, seen);
      }
      return out;
    }
    return value;
  }

  // -- cross-realm bridges: the peer side of a port (M147 Phase C) ----------

  /** Materialise a peer-owned port as a local proxy `MessagePort`. */
  function createBridgedEndpoint(id: string): { port: PortObject; endpoint: Endpoint } {
    const port = Object.create(MessagePort.prototype) as PortObject;
    const endpoint: Endpoint = {
      group: null,
      incoming: [],
      owner: null,
      receiving: false,
      refed: true,
      scheduled: false,
      bridge: { role: 'handle', id },
    };
    bridges.set(id, endpoint);
    initHandle(port, endpoint);
    return { port, endpoint };
  }

  /** A frame arrived from the peer realm. */
  function onBridgeFrame(frame: PortBridgeFrame): void {
    if (frame === null || typeof frame !== 'object') return;
    if (frame.__wnPort === 'close') {
      closeBridgedEndpoint(frame.id);
      return;
    }
    if (frame.__wnPort !== 'msg') return;
    const endpoint = bridges.get(frame.id);
    if (endpoint === undefined) return;
    const tokens: TokenRef[] = frame.tokens.map((t) => {
      const { endpoint: peerEndpoint } = createBridgedEndpoint(t.id);
      return { token: t.token, endpoint: peerEndpoint };
    });
    const envelope: Envelope = { kind: 'message', data: frame.data, tokens };
    if (endpoint.bridge?.role === 'handle') {
      // A message addressed to our proxy: deliver it to the local handle.
      endpoint.incoming.push(envelope);
      trigger(endpoint);
      return;
    }
    // A message posted by the peer's proxy: dispatch it into our group, never
    // back through the endpoint it came in on.
    const group = endpoint.group;
    if (group === null) return;
    for (const sibling of [...group.members]) {
      if (sibling === endpoint) continue;
      sibling.incoming.push(envelope);
      trigger(sibling);
    }
  }

  /** The peer told us its half of the link is gone. */
  function closeBridgedEndpoint(id: string): void {
    const endpoint = bridges.get(id);
    if (endpoint === undefined) return;
    bridges.delete(id);
    const bridge = endpoint.bridge;
    endpoint.bridge = undefined;
    if (endpoint.group !== null) {
      // The group half leaves its local group (which tells any remaining proxy
      // siblings this realm still has).
      disentangle(endpoint);
    } else if (endpoint.owner !== null) {
      // The proxy half closes its local handle (emitting `close`).
      closeHandle(endpoint.owner);
    }
  }

  // -- the binding surface ---------------------------------------------------

  return {
    // `internal/worker/io.js` re-exports these; the messaging binding itself
    // owns the prototype the module mutates.
    MessagePort,
    MessageChannel,
    broadcastChannel,
    // Bound to one name so each `BroadcastChannel` shares the same sibling group,
    // exactly like `SiblingGroup::Get(name)` in Node. io.js destructures this
    // name from the binding.
    BroadcastChannel: broadcastChannel,
    // The cross-realm bridge (M147 Phase C): the transport owner (thread
    // bootstrap / `RealWorker`) wires this so ports can cross a thread boundary.
    __ports: {
      connect: (send: (frame: PortBridgeFrame) => void): void => {
        transport = send;
      },
      onFrame: (frame: PortBridgeFrame): void => onBridgeFrame(frame),
      importPort: (id: string): unknown => createBridgedEndpoint(id).port,
      buildMessage: (value: unknown, transferList?: unknown) => {
        const { ports, buffers } = collectTransferList(null, transferList);
        return buildCrossRealmMessage(value, ports, buffers);
      },
      importMessage: (frame: PortBridgeMessageFrame) => {
        const tokens: TokenRef[] = frame.tokens.map((t) => {
          const { endpoint } = createBridgedEndpoint(t.id);
          return { token: t.token, endpoint };
        });
        const { message, ports } = deserialize({ kind: 'message', data: frame.data, tokens });
        return { value: message, ports };
      },
    } satisfies PortBridgeApi,
    // Ports are refed/unrefed as a bookkeeping flag for `hasRef()` parity. They
    // do NOT keep the simulated process alive: there is no libuv loop here, and
    // the runner ends a program once its timer queue is empty, so a refed idle
    // port must not spin forever the way it would in a real Node process.
    drainMessagePort: (port: unknown) => {
      const endpoint = endpointOf(port);
      if (endpoint !== null) run(endpoint, true);
    },
    stopMessagePort: (port: unknown) => {
      const endpoint = endpointOf(port);
      if (endpoint !== null) endpoint.receiving = false;
    },
    receiveMessageOnPort: (port: unknown) => {
      if (!isPort(port)) {
        throw invalidArgType('port', 'The "port" argument must be a MessagePort instance');
      }
      const endpoint = endpointOf(port);
      if (endpoint === null) return symbol('no_message_symbol');
      const envelope = endpoint.incoming.shift();
      if (envelope === undefined) return symbol('no_message_symbol');
      if (envelope.kind === 'close') {
        closeHandle(port as object);
        return symbol('no_message_symbol');
      }
      // The binding hands back the deserialized payload (or the sentinel);
      // `internal/worker/io.js` is what wraps it into `{ message }`.
      return deserialize(envelope).message;
    },
    // Node moves the port into another V8 context; this runtime has exactly one,
    // so the port already lives where it is being sent.
    moveMessagePortToContext: (port: unknown) => {
      if (!isPort(port)) {
        throw invalidArgType('port', 'The "port" argument must be a MessagePort instance');
      }
      if (HANDLES.get(port as object)!.closed) {
        throw code('ERR_CLOSED_MESSAGE_PORT', 'Cannot send data on closed MessagePort');
      }
      return port;
    },
    setDeserializerCreateObjectFunction: () => undefined,
    setDeserializeMainFunction: () => undefined,
    isBuildingSnapshot: () => false,
    DOMException:
      typeof (globalThis as { DOMException?: unknown }).DOMException === 'function'
        ? (globalThis as { DOMException: unknown }).DOMException
        : undefined,
    structuredClone: (value: unknown, options?: { transfer?: unknown }) => {
      const list = options?.transfer;
      const transfer = list === undefined ? [] : readTransferList(list);
      return structuredCloneOf(value, transfer as ArrayBuffer[]);
    },
    exposeLazyDOMExceptionProperty: () => undefined,
    QuotaExceededError:
      typeof (globalThis as { DOMException?: unknown }).DOMException === 'function'
        ? class QuotaExceededError extends (
            globalThis as unknown as { DOMException: new (m?: string, n?: string) => Error }
          ).DOMException {}
        : undefined,
  };
};

/**
 * `worker` binding: the main-thread constants `internal/worker/io.js` reads, and
 * `getEnvMessagePort`.
 *
 * There is no worker environment in this runtime, so `getEnvMessagePort` is the
 * one honest answer for `createWorkerStdio()`: it cannot be reached. Tools that
 * build a worker bootstrap call it; user code cannot.
 */
export const workerBinding: BindingFactory = () => ({
  isMainThread: true,
  threadId: 0,
  threadName: 'main',
  ownsProcessState: true,
  resourceLimits: undefined,
  getEnvMessagePort: () => {
    throw new Error(
      'worker_threads: this runtime has no worker environment, so there is no parent port.',
    );
  },
});
