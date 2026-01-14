/**
 * MCP (Model Context Protocol) Tools for fsx
 *
 * This module provides filesystem tools for AI-assisted file operations
 * via the Model Context Protocol (MCP).
 *
 * ## Available Tools
 *
 * - `fs_search` - Glob pattern file search with content filtering
 * - `fs_list` - Directory listing with recursive, pattern filtering, and pagination
 * - `fs_mkdir` - Directory creation with recursive and permission support
 * - `fs_stat` - File/directory statistics with symlink handling
 * - `fs_lstat` - File/directory statistics (does not follow symlinks)
 * - `fs_tree` - Directory tree visualization with ASCII and JSON output
 * - `fs_read` - Read file contents
 * - `fs_write` - Write content to a file
 * - `fs_append` - Append content to a file
 * - `fs_delete` - Delete a file or directory
 * - `fs_move` - Move/rename a file or directory
 * - `fs_copy` - Copy a file
 * - `fs_exists` - Check if a file or directory exists
 *
 * ## Tool Infrastructure
 *
 * - `registerTool()` - Register custom tools
 * - `unregisterTool()` - Remove tools from registry
 * - `invokeTool()` - Dispatch to tool handler by name
 * - `getToolRegistry()` - Get registry interface
 * - `fsTools` - Array of all built-in fs_* tools
 *
 * @module core/mcp
 */

// Shared utilities and types
export {
  // Types
  type McpToolResult,
  type StorageBackend,
  type StorageEntry,
  type ExtendedStorageBackend,
  type TraversalEntry,
  type TraversalOptions,
  // Path utilities
  normalizePath,
  joinPath,
  getRelativePath,
  isPathTraversal,
  // Symlink handling
  resolveSymlink,
  // Entry helpers
  getEntrySize,
  getEntryMtime,
  collectDirectoryEntries,
  // Result helpers
  errorResult,
  successResult,
} from './shared'

// fs_search - Glob pattern file search
export {
  invokeFsSearch,
  // Types
  type FsSearchOptions,
  type SearchResultItem,
  // Utilities (exported for testing)
  shouldExclude,
  countContentMatches,
  searchDirectory,
} from './fs-search'

// fs_list - Directory listing
export {
  invokeFsList,
  // Types
  type FsListOptions,
} from './fs-list'

// fs_mkdir - Directory creation
export {
  invokeFsMkdir,
  // Types
  type FsMkdirOptions,
} from './fs-mkdir'

// fs_stat - File/directory statistics
export {
  invokeFsStat,
  invokeFsLstat,
  fsLstatToolSchema,
  // Types
  type McpStatResult,
  type StatFileEntry,
  type StatStorageBackend,
  type TypeFlags,
  type BuildStatOptions,
  type SymlinkResolution,
  // Utilities (exported for fs_list integration)
  buildStatResult,
  detectFileType,
  resolveSymlinkChain,
  getContentSize,
  calculateBlocks,
  isPathTraversal as isStatPathTraversal,
  // Constants
  DEFAULT_BLOCK_SIZE,
  BLOCKS_UNIT_SIZE,
  MAX_SYMLINK_DEPTH,
} from './fs-stat'

// fs_tree - Directory tree visualization
export {
  invokeFsTree,
  formatSize,
  // Types
  type FsTreeOptions,
  type TreeNode,
} from './fs-tree'

// Tool registry - Infrastructure for tool registration and invocation
export {
  // Core registry functions
  registerTool,
  unregisterTool,
  invokeTool,
  getToolRegistry,
  clearToolRegistry,
  // Middleware support
  useMiddleware,
  clearMiddleware,
  // Utility functions
  isBuiltinTool,
  // fsTools array with all built-in tools
  fsTools,
  // Types
  type PropertySchema,
  type InputSchema,
  type McpToolSchema,
  type McpToolHandler,
  type McpTool,
  type ToolRegistry,
  type InvokeToolOptions,
  type ToolContext,
  type ToolMiddleware,
  // All tool schemas
  fsSearchToolSchema,
  fsListToolSchema,
  fsTreeToolSchema,
  fsStatToolSchema,
  fsMkdirToolSchema,
  fsReadToolSchema,
  fsWriteToolSchema,
  fsAppendToolSchema,
  fsDeleteToolSchema,
  fsMoveToolSchema,
  fsCopyToolSchema,
  fsExistsToolSchema,
} from './tool-registry'
