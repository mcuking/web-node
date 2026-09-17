/**
 * Structured "not implemented" error used whenever a Node internal binding,
 * builtin module, or API is outside our supported whitelist.
 *
 * Rule: never return `undefined` for something we do not implement. A loud,
 * typed error is far more useful than a mysterious downstream crash.
 */
export class NotImplementedError extends Error {
  code = 'ERR_WEB_NODE_NOT_IMPLEMENTED';
  subject: string;
  kind: 'binding' | 'module' | 'api';

  constructor(kind: 'binding' | 'module' | 'api', subject: string, hint?: string) {
    super(
      `[web-node] ${kind} "${subject}" is not implemented.` +
        (hint ? ` ${hint}` : '') +
        ` See docs/superpowers/specs/2026-09-17-web-node-design.md for the supported surface.`,
    );
    this.name = 'NotImplementedError';
    this.kind = kind;
    this.subject = subject;
  }
}

export function notImplemented(
  kind: 'binding' | 'module' | 'api',
  subject: string,
  hint?: string,
): NotImplementedError {
  return new NotImplementedError(kind, subject, hint);
}
