import type { RpcTarget } from 'capnweb'
import type { RpcPromise } from './fn'
import type { Thing, ThingData } from './Thing'
import type { Things, ThingsCollection } from './Things'
import type { Noun, NounData } from './Noun'
import type { Verb, VerbData } from './Verb'
import type { WorkflowContext, ScheduleBuilder, EventHandler } from './WorkflowContext'
import type {
  AITemplateLiteralFn,
  AIPipelinePromise,
  WriteResult,
  ExtractResult,
  DecideFn,
} from './WorkflowContext'

// ============================================================================
// AI FUNCTION TYPES (DO-specific, extends WorkflowContext AI functions)
// ============================================================================

/** General AI completion - template literal */
export type AIFunction = AITemplateLiteralFn<string>

/** Text generation with structured output */
export type WriteFunction = AITemplateLiteralFn<WriteResult>

/** Summarization */
export type SummarizeFunction = AITemplateLiteralFn<string>

/** List generation */
export type ListFunction = AITemplateLiteralFn<string[]>

/** Data extraction with typed entities */
export type ExtractFunction = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => AIPipelinePromise<ExtractResult<T>>

/** Code generation */
export type CodeFunction = AITemplateLiteralFn<string>

/** Diagram generation (Mermaid, SVG) */
export type DiagramFunction = AITemplateLiteralFn<string>

/** Binary classification */
export type IsFunction = AITemplateLiteralFn<boolean>

/** Multi-option classification factory */
export type DecideFunction = DecideFn

/** Human question - ask for input */
export type AskFunction = AITemplateLiteralFn<string>

/** Human approval - yes/no decision */
export type ApproveFunction = AITemplateLiteralFn<boolean>

/** Human review - approval with feedback */
export type ReviewFunction = AITemplateLiteralFn<{ approved: boolean; feedback: string }>

/** Web research */
export type ResearchFunction = AITemplateLiteralFn<unknown>

/** URL reading */
export type ReadFunction = (url: string) => AIPipelinePromise<string>

/** Browser automation */
export type BrowseFunction = (url: string, instructions: string) => AIPipelinePromise<unknown>

/** Code/test evaluation */
export type EvaluateFunction = (options: EvaluateOptions) => AIPipelinePromise<EvaluateResult>

/** Options for evaluate function */
export interface EvaluateOptions {
  module?: string
  tests?: string
  script?: string
  timeout?: number
}

/** Result from evaluate function */
export interface EvaluateResult {
  success: boolean
  value?: unknown
  logs: string[]
  testResults?: TestResult[]
  error?: unknown
  duration: number
}

/** Individual test result */
export interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

// ============================================================================
// DO - Base Durable Object class (batteries included)
// ============================================================================

export interface DO extends RpcTarget {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  readonly ns: string // Namespace (domain by default)

  // A DO's ns IS its identity
  // When a Thing is promoted, its $id becomes a DO's ns

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA MODEL (Drizzle tables)
  // ═══════════════════════════════════════════════════════════════════════════

  readonly nouns: NounsRegistry
  readonly verbs: VerbsRegistry
  readonly things: ThingsTable
  readonly relationships: RelationshipsTable
  readonly objects: ObjectsTable
  readonly actions: ActionsTable
  readonly events: EventsTable
  readonly search: SearchTable

  // ═══════════════════════════════════════════════════════════════════════════
  // TYPED COLLECTION ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  // Get typed collection by noun name
  collection<T extends Thing = Thing>(noun: string): ThingsCollection<T>

  // Dynamic accessors (generated from nouns registry)
  // e.g., this.Startup → this.collection<Startup>('Startup')
  readonly [noun: string]: ThingsCollection | unknown

  // ═══════════════════════════════════════════════════════════════════════════
  // AI PRIMITIVES (ai-functions)
  // ═══════════════════════════════════════════════════════════════════════════

  // Generation
  ai: AIFunction
  write: WriteFunction
  summarize: SummarizeFunction
  list: ListFunction
  extract: ExtractFunction
  code: CodeFunction
  diagram: DiagramFunction

  // Classification
  is: IsFunction
  decide: DecideFunction

  // Human-in-loop
  ask: AskFunction
  approve: ApproveFunction
  review: ReviewFunction

  // Research
  research: ResearchFunction
  read: ReadFunction
  browse: BrowseFunction

  // Execution (ai-evaluate)
  evaluate: EvaluateFunction

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW CONTEXT (ai-workflows)
  // ═══════════════════════════════════════════════════════════════════════════

  readonly $: WorkflowContext

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  // Resolve any URL to a Thing (local, cross-DO, or external)
  resolve(url: string): RpcPromise<Thing>

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  // Called when DO is first created
  initialize(config: DOConfig): RpcPromise<void>

  // Promote a Thing to its own DO
  promoteThing(url: string): RpcPromise<DO>

  // Promote a collection to its own DO
  promoteCollection(noun: string): RpcPromise<DO>
}

// ============================================================================
// TABLE INTERFACES
// ============================================================================

export interface NounsRegistry {
  get(noun: string): RpcPromise<Noun | null>
  list(): RpcPromise<Noun[]>
  create(data: NounData): RpcPromise<Noun>
  update(noun: string, data: Partial<NounData>): RpcPromise<Noun>
  delete(noun: string): RpcPromise<void>
}

export interface VerbsRegistry {
  get(verb: string): RpcPromise<Verb | null>
  list(): RpcPromise<Verb[]>
  create(data: VerbData): RpcPromise<Verb>
  update(verb: string, data: Partial<VerbData>): RpcPromise<Verb>
  delete(verb: string): RpcPromise<void>
}

export interface ThingsTable {
  get($id: string): RpcPromise<Thing | null>
  list(query?: { ns?: string; $type?: string }): RpcPromise<Thing[]>
  create(data: Partial<ThingData>): RpcPromise<Thing>
  update($id: string, data: Partial<ThingData>): RpcPromise<Thing>
  delete($id: string): RpcPromise<void>
  find(query: Record<string, unknown>): RpcPromise<Thing[]>
}

export interface RelationshipsTable {
  get(id: string): RpcPromise<Relationship | null>
  list(query?: { from?: string; to?: string; verb?: string }): RpcPromise<Relationship[]>
  create(data: { verb: string; from: string; to: string; data?: unknown }): RpcPromise<Relationship>
  delete(id: string): RpcPromise<void>
  // Get outbound edges for a Thing
  outbound(from: string): RpcPromise<Relationship[]>
  // Get inbound edges for a Thing
  inbound(to: string): RpcPromise<Relationship[]>
}

export interface ObjectsTable {
  get(ns: string): RpcPromise<ObjectRef | null>
  list(query?: { relationType?: string }): RpcPromise<ObjectRef[]>
  create(data: { ns: string; doId: string; doClass: string; relationType?: string }): RpcPromise<ObjectRef>
  delete(ns: string): RpcPromise<void>
}

export interface ActionsTable {
  get(id: string): RpcPromise<Action | null>
  list(query?: { target?: string; actor?: string; verb?: string; status?: string }): RpcPromise<Action[]>
  create(data: Partial<Action>): RpcPromise<Action>
  update(id: string, data: Partial<Action>): RpcPromise<Action>
  // Undo an action
  undo(id: string): RpcPromise<Action>
}

export interface EventsTable {
  get(id: string): RpcPromise<Event | null>
  list(query?: { source?: string; verb?: string }): RpcPromise<Event[]>
  // Stream unstreamed events to Pipeline
  streamPending(): RpcPromise<number>
}

export interface SearchTable {
  index(thing: Thing): RpcPromise<void>
  search(query: string, options?: { type?: string; limit?: number }): RpcPromise<SearchResult[]>
  remove($id: string): RpcPromise<void>
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

export interface DOConfig {
  ns: string
  parent?: string // Parent DO's ns
}

export interface Relationship {
  id: string
  verb: string
  from: string // URL
  to: string // URL
  data?: Record<string, unknown>
  createdAt: Date
}

export interface ObjectRef {
  ns: string
  doId: string
  doClass: string
  relationType?: 'parent' | 'child' | 'follower' | 'shard' | 'reference'
  shardKey?: string
  shardIndex?: number
  region?: string
  isPrimary?: boolean
  cached?: Record<string, unknown>
  createdAt: Date
}

export interface Action {
  id: string
  verb: string
  target: string
  actor?: string
  input?: unknown
  output?: unknown
  before?: unknown
  after?: unknown
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error?: unknown
  requestId?: string
  sessionId?: string
  startedAt?: Date
  completedAt?: Date
  duration?: number
  createdAt: Date
}

export interface Event {
  id: string
  verb: string
  source: string
  data: unknown
  actionId?: string
  sequence: number
  streamed: boolean
  streamedAt?: Date
  createdAt: Date
}

export interface SearchResult {
  $id: string
  $type: string
  content: string
  score: number
}

// ============================================================================
// RE-EXPORT WORKFLOW CONTEXT TYPES
// ============================================================================

// WorkflowContext and related types are now defined in ./WorkflowContext.ts
// They extend WorkflowContextType from @org.ai/types with DO-specific features
export type { WorkflowContext, ScheduleBuilder, EventHandler }
