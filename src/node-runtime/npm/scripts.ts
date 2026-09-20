/**
 * Lifecycle scripts.
 *
 * npm runs a package's `preinstall`/`install`/`postinstall` while installing it,
 * then the root project's own lifecycle, all through a shell with a documented
 * set of environment variables. This reproduces that shape:
 *
 *   `npm_package_name`, `npm_package_version`, `npm_package_json`,
 *   `npm_lifecycle_event`, `npm_lifecycle_script`, `npm_command`, `INIT_CWD`,
 *   `npm_node_execpath`, `npm_config_user_agent`
 *
 * ## Trust model — the part worth being explicit about
 *
 * An install script is code from the registry running inside this page. There is
 * no OS sandbox underneath: it can read and write the virtual file system it was
 * installed into and it can reach the virtual network. The mitigation is
 * visibility, not isolation:
 *
 *   - every script's output is streamed to the caller, untruncated, and
 *   - a non-zero exit is reported as a warning rather than thrown, and
 *   - `ignoreScripts` turns the whole stage off.
 *
 * **Divergence from npm, deliberate:** npm fails the install when a lifecycle
 * script fails. Here the failure is recorded and the install continues, because
 * a browser tab has no `--ignore-scripts` escape hatch for a package the user
 * cannot easily replace, and a half-written `node_modules` is worse than a
 * usable one with a loud warning attached.
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import type { ProcessHost } from '../proc/host';
import { runShell } from '../shell/sh';

/** Per-script wall-clock limit. A runaway script must not wedge the tab. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

/** The lifecycle events this installer honours, in npm's order. */
export const DEPENDENCY_LIFECYCLE = ['preinstall', 'install', 'postinstall'] as const;
export const ROOT_LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'] as const;

export type LifecycleEvent = (typeof ROOT_LIFECYCLE)[number];

export interface ScriptContext {
  host: ProcessHost;
  vfs: Vfs;
  /** Directory the script runs in. */
  cwd: string;
  /** The project root that started the install (`INIT_CWD`). */
  initCwd: string;
  baseEnv: Record<string, string>;
  timeoutMs?: number;
  onOutput?(chunk: Uint8Array, stream: 'stdout' | 'stderr'): void;
}

export interface ScriptOutcome {
  event: string;
  package: string;
  script: string;
  code: number;
}

/** The environment npm exposes to a lifecycle script. */
export function lifecycleEnv(
  context: ScriptContext,
  manifest: { name?: string; version?: string },
  event: string,
  script: string,
): Record<string, string> {
  return {
    ...context.baseEnv,
    INIT_CWD: context.initCwd,
    npm_command: 'install',
    npm_lifecycle_event: event,
    npm_lifecycle_script: script,
    npm_node_execpath: 'node',
    npm_execpath: 'web-node',
    npm_config_user_agent: 'web-node/0.1.0 npm/? node/v26.9.1 linux wasm32',
    npm_package_name: manifest.name ?? '',
    npm_package_version: manifest.version ?? '',
    npm_package_json: p.join(context.cwd, 'package.json'),
  };
}

export interface RunScriptsOptions extends ScriptContext {
  ignoreScripts?: boolean;
  warnings: string[];
  log?(message: string): void;
}

/** Run one named script from a manifest's `scripts` map. */
export async function runScript(
  options: RunScriptsOptions,
  manifest: { name?: string; version?: string; scripts?: Record<string, string> },
  event: string,
  label: string,
): Promise<ScriptOutcome | null> {
  const script = manifest.scripts?.[event];
  if (!script || !script.trim()) return null;
  if (options.ignoreScripts) {
    options.log?.(`~ ${label} ${event} (ignored)`);
    return null;
  }

  options.log?.(`> ${label} ${event}`);
  const result = await runShell(script, {
    host: options.host,
    vfs: options.vfs,
    cwd: options.cwd,
    env: lifecycleEnv(options, manifest, event, script),
    timeoutMs: options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
    onOutput: options.onOutput,
  });

  if (result.code !== 0) {
    options.warnings.push(
      `${label}: "${event}" script exited with code ${result.code} (${script})`,
    );
  }
  return { event, package: label, script, code: result.code };
}

/**
 * Run a package's dependency lifecycle (`preinstall`, `install`, `postinstall`).
 *
 * Returns the events that actually ran, so the caller can report them.
 */
export async function runDependencyScripts(
  options: RunScriptsOptions,
  packageDir: string,
  manifest: { name?: string; version?: string; scripts?: Record<string, string> },
): Promise<ScriptOutcome[]> {
  const outcomes: ScriptOutcome[] = [];
  const label = `${manifest.name ?? p.basename(packageDir)}@${manifest.version ?? '0.0.0'}`;
  for (const event of DEPENDENCY_LIFECYCLE) {
    const outcome = await runScript(
      { ...options, cwd: packageDir },
      manifest,
      event,
      label,
    );
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}

/** Run the root project's lifecycle in npm's order. */
export async function runRootScripts(
  options: RunScriptsOptions,
  manifest: { name?: string; version?: string; scripts?: Record<string, string> },
): Promise<ScriptOutcome[]> {
  const outcomes: ScriptOutcome[] = [];
  const label = manifest.name ?? 'project';
  for (const event of ROOT_LIFECYCLE) {
    const outcome = await runScript(options, manifest, event, label);
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}
