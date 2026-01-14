/**
 * Graph Compat Module
 *
 * Provides graph-related utilities and stores for the dotdo platform.
 * This module bridges the core graph model with compat layer functionality.
 *
 * @module db/compat/graph
 */

// Session Thing Store
export { SessionThingStore } from './src/session-thing-store'
export type {
  SessionData,
  SessionThing,
  UserThing,
  SessionAndUser,
  CreateSessionInput,
} from './src/session-thing-store'

// Traversal and query utilities
export { TraversalBuilder, createTraversal } from './src/traversal-builder'
export type { Direction, RelationType, TraversalStep } from './src/traversal-builder'

export { Traversal, Graph, createGraph } from './src/set-operations'
export type { MagicTraversal, GraphNode, GraphOptions } from './src/set-operations'

export { createTypedGraph } from './src/typed-schema'
export type { GraphSchema, NodeTypes, RelationshipTypes, TypedGraphClient } from './src/typed-schema'

export { detectReverse } from './src/reverse-detection'
export type { ReverseDetectionResult } from './src/reverse-detection'

export { createCollectionGraph } from './src/collection-accessor'
export type { CollectionGraph, TypeCollection, Traversal as CollectionTraversal } from './src/collection-accessor'

export { createMagicProxy } from './src/magic-proxy'
export type { MagicTraversal as MagicProxyTraversal, TraversalContext } from './src/magic-proxy'

export { TraversalEngine, AdjacencyIndex, createTraversalEngine } from './src/traversal-engine'
export type { TraversalResult, TraversalStats, TraversalOptions } from './src/traversal-engine'

export { GraphAnalytics, createGraphAnalytics } from './src/graph-analytics'
export type { PageRankOptions, PageRankResult, CommunityResult, ConnectedComponentsResult } from './src/graph-analytics'

export { createStreamingTraversal } from './src/streaming'
export type { StreamingTraversal, StreamingContext, TypeCollectionAccessor } from './src/streaming'

// Tool-related graph functionality
export { createToolGraph } from './src/tool-things'
export type { ToolThing, ToolGraph, ToolCreateInput, ToolQueryOptions, ToolInvocation } from './src/tool-things'

export { createInvocationGraph } from './src/tool-invocations'
export type { InvocationGraph, ToolInvocation as InvocationToolInvocation, InvocationMetrics } from './src/tool-invocations'

export { createToolProviderGraph } from './src/tool-provider-graph'
export type { ToolProviderGraph, ProviderThing, ToolThing as ProviderToolThing, CredentialThing } from './src/tool-provider-graph'
