/**
 * Graph Adapters Module
 *
 * Exports adapters that provide domain-specific interfaces on top of the GraphStore.
 *
 * @module db/graph/adapters
 */

// FileGraphAdapter - filesystem operations via the graph
export {
  createFileGraphAdapter,
  FileGraphAdapterImpl,
  InMemoryContentStore,
} from './file-graph-adapter'

export type {
  FileGraphAdapter,
  FileData,
  DirectoryData,
  CreateFileOptions,
  MkdirOptions,
  ContentStore,
} from './file-graph-adapter'

// GitGraphAdapter - git objects as Things in the graph
export { GitGraphAdapter } from './git-graph-adapter'

export type {
  GitIdentityData,
  TreeEntryData,
  CommitData,
  TreeData,
  BlobData,
  RefData,
} from './git-graph-adapter'

// FunctionVersionAdapter - function versioning with content-addressable storage
export { FunctionVersionAdapter } from './function-version-adapter'

export type {
  FunctionData as FunctionVersionAdapterData,
  FunctionVersionData,
  FunctionBlobData,
  FunctionRefData,
} from './function-version-adapter'

// FunctionGraphAdapter - cascade chain resolution via graph relationships
export {
  FunctionGraphAdapter,
  createFunctionGraphAdapter,
  TYPE_IDS as FUNCTION_TYPE_IDS,
} from './function-graph-adapter'

// Re-export centralized constants for convenience
export {
  AUTH_TYPE_IDS,
  HUMAN_TYPE_IDS,
  GIT_TYPE_IDS,
  FUNCTION_TYPE_IDS as GRAPH_FUNCTION_TYPE_IDS,
  HUMAN_EXECUTION_TYPE_IDS,
  HUMAN_REQUEST_TYPE_IDS,
  TYPE_IDS as ALL_TYPE_IDS,
} from '../constants'

export type {
  FunctionType,
  FunctionData,
  CascadeRelationshipData,
  CreateCascadeOptions,
  CascadeChainEntry,
  GetCascadeChainOptions,
  CascadeConfig,
  CreateVersionOptions,
} from './function-graph-adapter'
