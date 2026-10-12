# M151 — Browser capability detection + degraded-mode notice (P2b)

## Goal

Stop failing opaquely on a browser that lacks a required feature. Detect the
platform capabilities web-node depends on and **name the mode** the app is in,
telling the user what is degraded when something is missing.

## What is detected

| Feature | Why it matters | Detection |
| --- | --- | --- |
| cross-origin isolation | precondition for a shared `SharedArrayBuffer` | `self.crossOriginIsolated === true` |
| `SharedArrayBuffer` | rspack's shared linear memory; real `worker_threads` parallelism | `typeof SharedArrayBuffer === 'function'` |
| OPFS | the project store (persistence across reloads) | `typeof navigator.storage.getDirectory === 'function'` |

`realParallelism = crossOriginIsolated && sharedArrayBuffer` — a bare constructor
check is **not** enough: a non-isolated realm can still expose the constructor,
but constructing throws.

## Shape

`src/ui/capabilities.ts` is a pure module:

- `detectCapabilities(scope = globalThis)` → `BrowserCapabilities`
- `capabilityIssues(caps)` → `CapabilityIssue[]` (severity order)
- `capabilityMessage(issue)` → a user-facing sentence

Being a pure function of a `scope` object makes it unit-testable with no DOM
(the vitest environment here is `node`).

`src/ui/main.ts` calls it after the runtime reports `ready`: the facts line gains
`SAB: on/off`, and each missing capability writes one `[capability] …` line to
the terminal.

## Messages

- **no-isolation** — "cross-origin isolation is off, so SharedArrayBuffer is
  unavailable — rspack builds and worker_threads run without real parallelism."
- **no-opfs** — "the Origin Private File System is unavailable — projects will
  not persist across reloads (in-memory only)."

## Evidence

Dev server facts line: `… · runtime: isolated origin · SAB: on` (no warning).
Units: `test/capabilities.test.ts` (6) — full fidelity, isolation missing but
constructor present, OPFS missing, everything missing (order), default scope
does not throw, every issue has a message.
