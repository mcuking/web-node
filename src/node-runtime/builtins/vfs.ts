import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `vfs` — Node's virtual file system module (`lib/vfs.js`).
 *
 * Node's own file is a 45-line re-export of `internal/vfs/*`. We mirror it, with
 * one deviation: `RealFSProvider` and `ZipProvider` are not shipped.
 *
 * - `RealFSProvider` mounts the *host* filesystem, which does not exist inside a
 *   browser tab (the runtime's own storage — OPFS, or the in-memory VFS — is what
 *   plays that role here).
 * - `ZipProvider` needs `internal/zip`, a whole archive subsystem we do not
 *   vendor.
 *
 * Both are exported as constructors that fail loudly rather than as `undefined`,
 * so `require('vfs').RealFSProvider` keeps the shape real code probes for.
 */
export const vfsSpec: BuiltinSpec = {
  id: 'vfs',
  aliases: ['node:vfs'],
  origin: 'web-node',
  deps: [
    'internal/vfs/file_system',
    'internal/vfs/provider',
    'internal/vfs/providers/memory',
  ],
  init: (ctx: BuiltinInitContext) => {
    const { VirtualFileSystem } = ctx.require('internal/vfs/file_system') as {
      VirtualFileSystem: new (provider?: unknown, options?: unknown) => unknown;
    };
    const { VirtualProvider } = ctx.require('internal/vfs/provider') as {
      VirtualProvider: new (...args: never[]) => unknown;
    };
    const { MemoryProvider } = ctx.require('internal/vfs/providers/memory') as {
      MemoryProvider: new (...args: never[]) => unknown;
    };

    /** A provider we do not ship: constructing it is an explicit error. */
    function unsupportedProvider(name: string): new () => never {
      return class {
        constructor() {
          throw new Error(
            `web-node: vfs.${name} is not supported in the browser runtime`,
          );
        }
      } as unknown as new () => never;
    }

    const RealFSProvider = unsupportedProvider('RealFSProvider');
    const ZipProvider = unsupportedProvider('ZipProvider');

    /**
     * `lib/vfs.js`'s `create`: a provider is optional, and if the first argument
     * is a plain object it is the options bag.
     */
    function create(provider?: unknown, options?: unknown): unknown {
      if (
        provider != null &&
        !(provider instanceof VirtualProvider) &&
        typeof provider === 'object'
      ) {
        options = provider;
        provider = undefined;
      }
      return new VirtualFileSystem(provider, options);
    }

    return {
      create,
      VirtualFileSystem,
      VirtualProvider,
      MemoryProvider,
      RealFSProvider,
      ZipProvider,
    };
  },
};
