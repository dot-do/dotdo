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
