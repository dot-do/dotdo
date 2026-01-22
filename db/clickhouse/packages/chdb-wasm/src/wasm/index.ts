/**
 * WASM Module Exports
 *
 * This module provides access to the MergeTree WASM loader and bindings
 * for use in Cloudflare Workers.
 */

export {
  MergeTreeLoader,
  MergeTreePartReader,
  type MergeTreeModule,
  type MergeTreeModuleFactory,
  type Mark,
  type ColumnInfo,
} from './mergetree-loader';

export {
  MergeTreeBindings,
  allocString,
  freeString,
  readString,
  readResultBytes,
  readResultString,
  parseMarks,
  errorCodeToMessage,
  isError,
  MERGETREE_ERR_INVALID_PARAM,
  MERGETREE_ERR_CREATE_FAILED,
  MERGETREE_ERR_COLUMN_NOT_FOUND,
  MERGETREE_ERR_IO,
  MERGETREE_ERR_BAD_HANDLE,
  type MarkInfo,
} from './mergetree-bindings';

export {
  VFSBridge,
  InMemoryStorageProvider,
  parseMergeTreePath,
  isDataFile,
  isPartMetadataFile,
  VFS_OK,
  VFS_ENOENT,
  VFS_EIO,
  VFS_EBADF,
  VFS_EEXIST,
  VFS_ENOTDIR,
  VFS_EISDIR,
  VFS_EINVAL,
  VFS_ENOSPC,
  VFS_ENOTEMPTY,
  VFS_O_RDONLY,
  VFS_O_WRONLY,
  VFS_O_RDWR,
  VFS_O_CREAT,
  VFS_O_TRUNC,
  VFS_O_APPEND,
  VFS_O_EXCL,
  VFS_SEEK_SET,
  VFS_SEEK_CUR,
  VFS_SEEK_END,
  VFS_S_IFREG,
  VFS_S_IFDIR,
  type VFSStorageProvider,
  type FileStat,
  type DirEntry,
  type ParsedMergeTreePath,
  type PartMetadata,
} from './vfs-bridge';

export {
  DynamicQueryExecutor,
  type QueryResult,
  type QueryOptions,
  type ExtensionLoadResult,
  type CoreModule as QueryExecutorCoreModule,
} from './query-executor';

export {
  WASM_MODULE_PATH,
  CORE_MODULE_PATH,
  CORE_WASM_PATH,
  SIDE_MODULES,
  EXTENSION_MODULES,
  getWasmPath,
  validateWasmPath,
  getSideModulePath,
  getExtensionModulePath,
  listAllWasmPaths,
  type SideModuleName,
  type ExtensionModuleName,
} from './paths';

export {
  createCoreModuleWithWasm,
  createCoreModuleFromBinary,
  loadCoreModule,
  validateWasmBinary,
  type CoreModule,
  type CoreModuleExports,
  type CoreModuleRuntime,
  type CoreModuleOptions,
} from './core-loader';

export {
  StreamingWasmLoader,
  loadWasmFromR2,
  loadWasmFromAssets,
  isStreamingCompilationAvailable,
  benchmarkWasmLoading,
  type WasmLoaderEnv,
  type WasmLoadOptions,
  type WasmLoadResult,
} from './streaming-loader';
