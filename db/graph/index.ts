/**
 * Graph Module
 *
 * The DO Graph data model provides a unified way to work with Things (nodes)
 * and Relationships (edges). This module includes:
 *
 * - **Things**: Instances of Nouns (types) with JSON data payloads
 * - **Relationships**: Edges with verb-based predicates connecting Things
 * - **Verb Forms**: State encoding via verb conjugation (create/creating/created)
 * - **GraphEngine**: In-memory graph with traversals, path finding, and pattern matching
 * - **GraphStore**: Abstract interface for graph persistence
 * - **Stores**: SQLiteGraphStore and DocumentGraphStore implementations
 * - **Adapters**: File, Git, and Auth adapters on top of GraphStore
 * - **Analytics**: Columnar analytics for graph data
 * - **Event Delivery**: Guaranteed delivery for graph events
 *
 * @module db/graph
 *
 * @example
 * ```typescript
 * import {
 *   // Factory
 *   createGraphStore,
 *
 *   // Stores
 *   SQLiteGraphStore,
 *   DocumentGraphStore,
 *
 *   // Types
 *   GraphThing,
 *   GraphRelationship,
 *
 *   // Verb forms
 *   VerbFormStateMachine,
 *   parseVerbForm,
 *
 *   // In-memory engine
 *   GraphEngine
 * } from 'db/graph'
 *
 * // Create a GraphStore (factory pattern)
 * const store = await createGraphStore({
 *   backend: 'sqlite',  // or 'document'
 *   connectionString: ':memory:'
 * })
 *
 * // Create a Thing
 * const customer = await store.createThing({
 *   id: 'customer-alice',
 *   typeId: 1,
 *   typeName: 'Customer',
 *   data: { name: 'Alice' }
 * })
 *
 * // Query verb form state
 * const state = parseVerbForm('creating') // { type: 'activity', baseVerb: 'create' }
 * ```
 */

// ============================================================================
// FACTORY - Unified entry point for creating GraphStore instances
// ============================================================================

export {
  createGraphStore,
  createSQLiteGraphStore,
  createDocumentGraphStore,
} from './factory'

export type {
  GraphStoreBackend,
  CreateGraphStoreOptions,
} from './factory'

// ============================================================================
// TYPES - Common types and interfaces
// ============================================================================

export type {
  // Type aliases
  GraphNode,
  GraphEdge,
  // GraphStore interface
  GraphStore,
  // Graph operation options
  GraphTraversalOptions,
  GraphTraversalResult,
  GraphStatistics,
} from './types'

// ============================================================================
// THINGS - Graph nodes (instances of Nouns)
// ============================================================================

// Schema
export { graphThings } from './things'

// Types
export type {
  GraphThing,
  NewGraphThing,
  GetThingsByTypeOptions,
  UpdateThingInput,
  GraphThingsDb,
} from './things'

// CRUD Operations
export { createThing, getThing, getThingsByType, updateThing, deleteThing } from './things'

// ============================================================================
// RELATIONSHIPS - Graph edges with verb predicates
// ============================================================================

// Schema
export { graphRelationships } from './relationships'

// Types
export type { GraphRelationship, CreateRelationshipInput, RelationshipQueryOptions } from './relationships'

// Store class
export { RelationshipsStore } from './relationships'

// ============================================================================
// VERB FORMS - State encoding via verb conjugation
// ============================================================================

// Types
export type {
  VerbFormType,
  VerbFormState,
  VerbFormEdge,
  VerbConjugation,
} from './verb-forms'

// Functions
export {
  getVerbFormType,
  parseVerbForm,
  transitionVerbForm,
  queryByVerbFormState,
  getEdgeState,
  transitionEdge,
} from './verb-forms'

// State machine class
export { VerbFormStateMachine } from './verb-forms'

// ============================================================================
// ACTIONS - Action/Activity/Event lifecycle
// ============================================================================

// Types
export type {
  CreateActionInput,
  Action,
  Activity,
  Event,
} from './actions'

// Store class
export { ActionLifecycleStore, createActionLifecycleStore } from './actions'

// ============================================================================
// STORES - Concrete GraphStore implementations
// ============================================================================

// SQLiteGraphStore - Basic SQLite backend with Drizzle ORM
export { SQLiteGraphStore } from './stores/sqlite'

// DocumentGraphStore - Document-store style with MongoDB-like operators
export { DocumentGraphStore } from './stores/document'

// Re-export types from DocumentGraphStore
export type {
  IndexInfo,
  QueryOperators,
  LogicalQuery,
  FindThingsQuery,
  BulkUpdateFilter,
  BulkUpdateOperations,
  BulkUpdateResult,
  BulkDeleteResult,
  MatchStage,
  GroupStage,
  SortStage,
  AggregationStage,
  CollectionStats,
  TransactionSession,
} from './stores/document'

// ============================================================================
// EVENT DELIVERY - Guaranteed delivery for graph events
// ============================================================================

export { EventDeliveryStore } from './event-delivery'

export type {
  DeliverableEvent,
  UnstreamedEventsOptions,
  DeliveryResult,
  PipelineConfig,
} from './event-delivery'

// ============================================================================
// ANALYTICS - Columnar analytics backend for graph data
// ============================================================================

export { createGraphAnalytics } from './analytics'

export type { GraphAnalytics } from './analytics'

// ============================================================================
// ADAPTERS - Domain-specific interfaces on top of GraphStore
// ============================================================================

// File Graph Adapter - Filesystem operations via the graph
export {
  createFileGraphAdapter,
  FileGraphAdapterImpl,
  InMemoryContentStore,
} from './adapters'

export type {
  FileGraphAdapter,
  FileData,
  DirectoryData,
  CreateFileOptions,
  MkdirOptions,
  ContentStore,
} from './adapters'

// Git Graph Adapter - Git objects as Things
export { GitGraphAdapter } from './adapters'

export type {
  GitIdentityData,
  TreeEntryData,
  CommitData,
  TreeData,
  BlobData,
  RefData,
} from './adapters'

// Function Version Adapter - Function versioning with content-addressable storage
export { FunctionVersionAdapter } from './adapters'

export type {
  FunctionVersionAdapterData,
  FunctionVersionData,
  FunctionBlobData,
  FunctionRefData,
} from './adapters'

// Function Graph Adapter - Cascade chain resolution
export { FunctionGraphAdapter, createFunctionGraphAdapter } from './adapters'

export type {
  FunctionType,
  FunctionData,
  CascadeRelationshipData,
  CreateCascadeOptions,
  CascadeChainEntry,
  GetCascadeChainOptions,
} from './adapters'

// ============================================================================
// CASCADE CHAIN RESOLVER - Cascade chain resolution via graph relationships
// ============================================================================

export { CascadeChainResolver } from './cascade-chain-resolver'

export type {
  CascadePathOptions,
  CascadePathEntry,
  CascadeTarget,
  CascadeChainStats,
  CascadePath,
  CascadeValidationResult,
  CascadeValidationError,
  CascadeValidationWarning,
} from './cascade-chain-resolver'

// ============================================================================
// AUTH ADAPTER - better-auth database adapter using Graph model
// ============================================================================
// Note: GraphAuthAdapter is exported from 'auth/adapters' not from this module.
// This separation keeps auth concerns in the auth module while allowing
// auth to use GraphStore as a storage backend.
//
// Usage:
//   import { createGraphAuthAdapter, graphAuthAdapter } from '@/auth/adapters'
//   const adapter = await createGraphAuthAdapter(graphStore)
// ============================================================================

// ============================================================================
// USER GRAPH STORE - User as Thing with relationships
// ============================================================================

export {
  // Constants
  USER_TYPE_ID,
  USER_TYPE_NAME,
  USER_VERBS,
  // Type guards
  isUserThingData,
  isValidEmail,
  // CRUD operations
  createUser,
  getUser,
  getUserByEmail,
  getUserByExternalId,
  listUsers,
  updateUser,
  touchUser,
  recordUserSignIn,
  deleteUser,
  suspendUser,
  reactivateUser,
  // Profile operations
  getUserProfile,
  updateUserProfile,
  // Role relationships
  assignUserRole,
  removeUserRole,
  getUserRoles,
  userHasRole,
  // Organization relationships (memberOf)
  addUserToOrg,
  removeUserFromOrg,
  getUserOrganizations,
  isUserMemberOf,
  getUserOrgRole,
  // Social relationships (follows)
  followUser,
  unfollowUser,
  getFollowing,
  getFollowers,
  isFollowing,
  // Statistics
  getUserStats,
  getOrgUsers,
  getUsersWithRole,
} from './user'

export type {
  UserStatus,
  UserThingData,
  UserProfileData,
  CreateUserOptions,
  UpdateUserOptions,
  QueryUsersOptions,
  OrgMembershipData,
} from './user'

// ============================================================================
// ORGANIZATION GRAPH STORE - Organization as Thing with CRUD operations
// ============================================================================

export {
  // Constants
  ORGANIZATION_LABEL,
  MEMBER_OF_EDGE,
  CHILD_OF_EDGE,
  // Factory
  createOrganizationStore,
  // Store class
  OrganizationStore,
  OrganizationStoreImpl,
} from './organization'

export type {
  OrganizationType,
  OrganizationStatus,
  OrganizationPlan,
  MemberRole,
  MemberStatus,
  OrganizationInput,
  Organization,
  MembershipInput,
  Membership,
} from './organization'

// ============================================================================
// WORKER GRAPH STORE - Worker as Thing with CRUD operations
// ============================================================================

export {
  // Constants
  WORKER_TYPE_ID,
  WORKER_TYPE_NAME,
  // Store class
  WorkerStore,
} from './workers'

export type {
  WorkerKind,
  WorkerTier,
  WorkerStatus,
  WorkerData,
  WorkerThing,
  CreateWorkerInput,
  UpdateWorkerInput,
  WorkerQueryOptions,
} from './workers'

// ============================================================================
// TOOL GRAPH STORE - Tool as Thing with CRUD operations
// ============================================================================

export {
  // Constants
  TOOL_TYPE_ID,
  TOOL_TYPE_NAME,
  // Store class
  ToolStore,
  // MCP conversion functions
  toolThingToMcp,
  mcpToToolThing,
  // Permission checking
  canAgentUseTool,
} from './tools'

export type {
  ToolSecurityLevel,
  ToolGraphParameter,
  ToolData,
  ToolThing,
  CreateToolInput,
  UpdateToolInput,
  ToolQueryOptions,
  AgentContext,
  PermissionCheckResult,
} from './tools'

// ============================================================================
// TOOL PERMISSION CHECKER - Graph-based permission checking
// ============================================================================

export {
  ToolPermissionChecker,
  PermissionDeniedError,
} from './tool-permission-checker'

export type {
  ToolSecurityLevel as ToolPermissionSecurityLevel,
  AgentType,
  PermissionCheckResult as ToolPermissionCheckResult,
  PermissionNode,
  PermissionCheckAuditLog,
  ToolPermissionCheckerOptions,
} from './tool-permission-checker'

// ============================================================================
// MCP TOOL DISCOVERY - MCP-compatible tool discovery service
// ============================================================================

export {
  MCPToolDiscoveryService,
  createToolDiscoveryService,
} from './mcp-tool-discovery'

export type {
  MCPTool,
  MCPInputSchema,
  MCPSchemaProperty,
  MCPToolCall,
  MCPToolResult,
  MCPContent,
  ToolInvocation,
  InvocationQueryOptions,
  ToolDiscoveryOptions,
  ToolDiscoveryResult,
} from './mcp-tool-discovery'

// ============================================================================
// TOOL PROVIDERS - Provider integration for compat layer
// ============================================================================

export {
  ProviderRegistry,
  createProviderRegistry,
  // Built-in providers
  SENDGRID_PROVIDER,
  SLACK_PROVIDER,
  STRIPE_PROVIDER,
  S3_PROVIDER,
  TWILIO_PROVIDER,
  HUBSPOT_PROVIDER,
  DISCORD_PROVIDER,
  BUILTIN_PROVIDERS,
} from './tool-providers'

export type {
  ProviderCategory,
  ProviderStatus,
  ProviderData,
  ProviderThing,
  CreateProviderInput,
  ProviderToolTemplate,
  ProviderDefinition,
} from './tool-providers'

// ============================================================================
// ERRORS - Unified error hierarchy for the graph module
// ============================================================================

export {
  // Base error
  GraphError,
  // Not found errors
  NodeNotFoundError,
  EdgeNotFoundError,
  ThingNotFoundError,
  RelationshipNotFoundError,
  TypeNotFoundError,
  UserNotFoundError,
  RoleNotFoundError,
  OrganizationNotFoundError,
  FunctionNotFoundError,
  WorkflowInstanceNotFoundError,
  EventNotFoundError,
  ActionNotFoundError,
  ConversationNotFoundError,
  StepExecutionNotFoundError,
  InvitationNotFoundError,
  RefNotFoundError,
  // Duplicate/constraint errors
  DuplicateNodeError,
  DuplicateThingError,
  DuplicateEdgeError,
  DuplicateRelationshipError,
  DuplicateUserError,
  DuplicateAgentError,
  DuplicateWorkerError,
  DuplicateOrganizationError,
  // Validation errors
  ValidationError,
  InvalidVerbFormError,
  InvalidEmailError,
  InvalidModeError,
  InvalidMessageError,
  InvalidParticipantsError,
  NotAParticipantError,
  // State errors
  InvalidStateError,
  CycleDetectedError,
  InvalidWorkflowStateError,
  InvalidInvitationStateError,
  InvitationExpiredError,
  NotSuspendedError,
  SelfFollowError,
  // Initialization errors
  StoreNotInitializedError,
  ConnectionNotAvailableError,
  TemplateNotCreatedError,
  WorkflowNotLoadedError,
  // File system errors
  FileNotFoundError,
  FileExistsError,
  DirectoryNotEmptyError,
  PermissionError,
  // Batch operation errors
  BatchOperationError,
  // Delivery errors
  DeliveryError,
  PipelineDeliveryError,
  // Factory errors
  UnknownBackendError,
  ConfigurationError,
  // Approval workflow errors
  ApprovalRequestNotFoundError,
  ApprovalRelationshipNotFoundError,
  InvalidApprovalStateError,
  NotPastSlaError,
  // Event type errors
  NotAnEventError,
} from './errors'

// ============================================================================
// GRAPH ENGINE - In-memory graph with traversals and algorithms
// ============================================================================

export {
  // Class
  GraphEngine,
  // Types
  type Node,
  type Edge,
  type NodeQuery,
  type EdgeQuery,
  type WhereClause,
  type ComparisonOperators,
  type TraversalOptions,
  type TraversalResult,
  type PathResult,
  type ShortestPathOptions,
  type AllPathsOptions,
  type Pattern,
  type MatchResult,
  type GraphStats,
  type GraphExport,
  type PageRankOptions,
  type CentralityOptions,
  // Optimization types
  type LazyTraversalIterator,
  type IndexHint,
  type QueryHints,
} from './graph-engine'

// ============================================================================
// CONSTANTS - Centralized type ID definitions
// ============================================================================

export {
  // Domain-specific type IDs
  AUTH_TYPE_IDS,
  HUMAN_TYPE_IDS,
  GIT_TYPE_IDS,
  FUNCTION_TYPE_IDS,
  FUNCTION_VERSION_TYPE_IDS,
  HUMAN_EXECUTION_TYPE_IDS,
  HUMAN_REQUEST_TYPE_IDS,
  // Combined type IDs
  TYPE_IDS,
  // Helper functions
  isAuthTypeId,
  isHumanTypeId,
  isGitTypeId,
  isFunctionTypeId,
  isFunctionVersionTypeId,
  isHumanExecutionTypeId,
  isHumanRequestTypeId,
  getTypeIdDomain,
} from './constants'

export type {
  AuthTypeId,
  HumanTypeId,
  GitTypeId,
  FunctionTypeId,
  FunctionVersionTypeId,
  HumanExecutionTypeId,
  HumanRequestTypeId,
} from './constants'

// ============================================================================
// HANDOFF CHAIN TRACKING - Agent handoffs as graph relationships
// ============================================================================

export {
  // Constants
  HANDED_OFF_TO,
  // Core functions
  createHandoffRelationship,
  getHandoffChain,
  getHandoffChainForConversation,
  getHandoffSource,
  getHandoffTarget,
  checkCircularHandoff,
  getHandoffsBetweenAgents,
  getHandoffAnalytics,
  getAgentHandoffHistory,
  // HandoffProtocol integration
  createGraphBackedHandoffHooks,
} from './handoff-chain-tracking'

export type {
  // Types
  HandoffReason,
  HandoffContextData,
  CreateHandoffInput,
  HandoffRelationship,
  HandoffChainEntry,
  CircularHandoffCheckResult,
  HandoffAnalytics,
  AgentHandoffHistory,
  GetHandoffAnalyticsOptions,
  GetHandoffChainOptions,
  // HandoffProtocol integration types
  HandoffRequest as HandoffChainRequest,
  HandoffResult as HandoffChainResult,
  HandoffHooks as HandoffChainHooks,
} from './handoff-chain-tracking'

// ============================================================================
// TOOL INVOCATION TRACKING - Invocation relationships with metrics
// ============================================================================

export {
  // Constants
  VERB_INVOKE,
  VERB_INVOKING,
  VERB_INVOKED,
  INVOCATION_TYPE_ID,
  INVOCATION_TYPE_NAME,
  // Store class
  InvocationStore,
  // Executor class
  ToolExecutor,
  // Factory functions
  createInvocationStore,
  createToolExecutor,
} from './tool-invocation'

export type {
  // Status type
  InvocationStatus,
  // Data types
  InvocationData,
  Invocation,
  CreateInvocationInput,
  CompleteInvocationInput,
  InvocationQueryOptions,
  InvocationMetrics,
  CallChainEntry,
  // Executor types
  ToolHandler,
  ToolExecutionContext,
  RegisteredTool,
} from './tool-invocation'

// ============================================================================
// ADJACENCY INDEX - Columnar graph storage
// ============================================================================

export {
  // Class
  AdjacencyIndex,
  // Factory
  createAdjacencyIndex,
} from './adjacency-index'

export type {
  // Types
  AdjacencyEntry,
  ReverseEntry,
  EdgeDirection,
  NeighborQueryOptions,
  NeighborResult,
  NodeDegree,
  BloomFilterStats,
  SupernodeConfig,
  ShardInfo,
  GraphStats as AdjacencyGraphStats,
  IAdjacencyIndex,
} from './adjacency-index'

// ============================================================================
// TRAVERSAL ENGINE - Graph traversal algorithms on AdjacencyIndex
// ============================================================================

export {
  // Class
  TraversalEngine,
  // Factory
  createTraversalEngine,
} from './traversal-engine'

export type {
  // Options types
  BFSOptions,
  DFSOptions,
  PathOptions,
  AllPathsOptions,
  // Result types
  TraversalResult as AdjacencyTraversalResult,
  Path,
  ShortestPathResult,
  CycleResult,
  TraversalStats,
} from './traversal-engine'
