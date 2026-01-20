// @dotdo/fsx - Extended Filesystem Operations for Durable Objects
// Provides POSIX-like filesystem semantics backed by DO SQLite storage

export * from './types'
export { createFsxStore, type FsxStore, path } from './fsx'
export { FsxBackend, type FsxBackendConfig, defaultConfig } from './backend'
export * from './errors'
export * as pathUtils from './path'
