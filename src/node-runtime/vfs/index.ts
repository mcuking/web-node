export * from './types';
export type { Persistence, SnapshotSource } from './persistence';
export { MemoryVfs } from './memory';
export { OpfsPersistence } from './opfs';
export { OpfsFileStore, type DirectoryProvider } from './opfs-store';
export { OpfsWorkerPersistence, type FsWorkerUnavailable } from './opfs-worker';
export { FsService, SNAPSHOT_FILE, SNAPSHOT_VERSION, relativePath, type FileStore } from './fs-service';
export * as posix from './posix';
