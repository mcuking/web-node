/**
 * The cross-realm **MessagePort bridge** wire format (M147, Phase C).
 *
 * A real-thread worker is a separate realm, so a `MessagePort` cannot simply be
 * handed across the boundary the way an in-realm transfer is: the two realms do
 * not share the objects that make up a `SiblingGroup`. What *can* cross is a
 * small link descriptor, and the binding on each side then owns half of the
 * link:
 *
 *   - the **origin realm** keeps the endpoint in its group and turns messages
 *     its siblings post into `deliveries` for the peer;
 *   - the **peer realm** gets a proxy handle whose posts travel back and are
 *     dispatched into the origin group.
 *
 * One frame shape serves both directions; the receiver decides what to do from
 * the *role* of the endpoint it has registered under `id`:
 *
 *   - `handle` (a proxy for a group that lives in the peer) ⇒ the message is
 *     delivered to the local handle (emitted);
 *   - `group` (an endpoint whose group lives here) ⇒ the message is dispatched
 *     into this realm's group.
 *
 * `tokens` carries the ports a message transferred along with it (each with the
 * fresh bridge `id` its peer side will register under), so nested transfers
 * ride the same machinery. `close` tells the peer its half of the link is gone.
 */

/** A message one realm sends the other over the host transport. */
export interface PortBridgeMessageFrame {
  __wnPort: 'msg';
  /** The endpoint in the *receiving* realm this frame is routed to. */
  id: string;
  /** The payload, with any transferred ports replaced by their token strings. */
  data: unknown;
  /** Ports carried by this message, to be materialised as proxies on the peer. */
  tokens: Array<{ token: string; id: string }>;
}

/** Both halves of a link are gone once either side closes. */
export interface PortBridgeCloseFrame {
  __wnPort: 'close';
  id: string;
}

export type PortBridgeFrame = PortBridgeMessageFrame | PortBridgeCloseFrame;

/** The well-known display id of the `parentPort` ↔ `Worker` link. */
export const PARENT_PORT_ID = 'parent';

/**
 * The surface the messaging binding exposes so a host-transport owner (the
 * thread bootstrap, or the parent's `RealWorker`) can wire it up.
 */
export interface PortBridgeApi {
  /** Install the outbound transport (frames leaving this realm). */
  connect(send: (frame: PortBridgeFrame) => void): void;
  /** Feed a frame that arrived from the peer. */
  onFrame(frame: PortBridgeFrame): void;
  /** Materialise a peer-owned port as a local `MessagePort` proxy. */
  importPort(id: string): unknown;
  /** Serialise a message to cross the boundary (transfers ports as needed). */
  buildMessage(value: unknown, transferList?: unknown): {
    data: unknown;
    tokens: Array<{ token: string; id: string }>;
  };
  /** Rebuild a message that crossed the boundary (materialises its ports). */
  importMessage(frame: PortBridgeMessageFrame): { value: unknown; ports: unknown[] };
}
