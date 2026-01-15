import { expectType, expectNotType, expectAssignable, expectNotAssignable } from 'tsd'
import type {
  // Core entity types
  Thing,
  ThingData,

  // Noun/Verb types
  Noun,
  NounData,

  // Event types
  DomainEvent,
  EventHandler,

  // WorkflowContext types
  WorkflowContext,
  OnProxy,
  ScheduleBuilder,
  DomainProxy,
  DOFunction,

  // DO types
  DO,
  DOConfig,
  Relationship,
  ObjectRef,
  Action,
  Event,
  SearchResult,

  // Flag types
  Flag,
  Branch,
  Filter,
  FlagInput,
  BranchInput,
  FilterInput,

  // Collection types
  Collection,
  CollectionData,

  // AI Function types
  AIFunctionDefinition,
  ExecutionResult,

  // MCP types
  McpTool,
  McpToolResult,

  // Worker types
  IWorker,
  IAgent,
  Task,
  TaskResult,
} from '../index'

/**
 * Type Safety Verification Tests
 *
 * This file verifies that public API types do not leak `any` type.
 * Uses conditional type checks to detect `any` - the only type that
 * is both assignable to everything AND from everything.
 *
 * Issue: do-n5b (TypeScript - Tests for type safety violations)
 *
 * Philosophy: If a type is `any`, it defeats the purpose of TypeScript.
 * These tests ensure our public API maintains strict type safety.
 */

// ============================================================================
// Type-Level Any Detection Utility
// ============================================================================

/**
 * Detects if a type is `any`
 *
 * `any` is the only type where:
 * - It can be assigned to a function type, AND
 * - `unknown` can be assigned to it
 *
 * This dual condition uniquely identifies `any`.
 */
type IsAny<T> = 0 extends (1 & T) ? true : false

/**
 * Assert that a type is NOT `any`
 * Returns `true` if the type is NOT `any`, `false` otherwise
 */
type AssertNotAny<T> = IsAny<T> extends true ? false : true

// ============================================================================
// Core Entity Types - No Any Leakage
// ============================================================================

// Thing.$id should be string, not any
declare const thing: Thing
type ThingIdIsNotAny = AssertNotAny<Thing['$id']>
declare const thingIdNotAny: ThingIdIsNotAny
expectType<true>(thingIdNotAny)

// Thing.$type should be string, not any
type ThingTypeIsNotAny = AssertNotAny<Thing['$type']>
declare const thingTypeNotAny: ThingTypeIsNotAny
expectType<true>(thingTypeNotAny)

// ThingData properties should not be any
type ThingDataIdIsNotAny = AssertNotAny<ThingData['$id']>
declare const thingDataIdNotAny: ThingDataIdIsNotAny
expectType<true>(thingDataIdNotAny)

// ============================================================================
// Event Types - No Any Leakage
// ============================================================================

// DomainEvent properties should not be any
declare const event: DomainEvent
type EventVerbIsNotAny = AssertNotAny<DomainEvent['verb']>
declare const eventVerbNotAny: EventVerbIsNotAny
expectType<true>(eventVerbNotAny)

type EventSourceIsNotAny = AssertNotAny<DomainEvent['source']>
declare const eventSourceNotAny: EventSourceIsNotAny
expectType<true>(eventSourceNotAny)

type EventTimestampIsNotAny = AssertNotAny<DomainEvent['timestamp']>
declare const eventTimestampNotAny: EventTimestampIsNotAny
expectType<true>(eventTimestampNotAny)

// ============================================================================
// Flag Types - Verified Unknown (not Any)
// ============================================================================

// Branch.payload should use unknown, not any
type BranchPayloadIsNotAny = AssertNotAny<NonNullable<Branch['payload']>>
declare const branchPayloadNotAny: BranchPayloadIsNotAny
expectType<true>(branchPayloadNotAny)

// Branch.payload value type should be unknown, not any
type BranchPayloadValueIsNotAny = AssertNotAny<NonNullable<Branch['payload']>[string]>
declare const branchPayloadValueNotAny: BranchPayloadValueIsNotAny
expectType<true>(branchPayloadValueNotAny)

// Filter.value should be unknown, not any
type FilterValueIsNotAny = AssertNotAny<Filter['value']>
declare const filterValueNotAny: FilterValueIsNotAny
expectType<true>(filterValueNotAny)

// Flag.traffic should be number, not any
type FlagTrafficIsNotAny = AssertNotAny<Flag['traffic']>
declare const flagTrafficNotAny: FlagTrafficIsNotAny
expectType<true>(flagTrafficNotAny)

// ============================================================================
// DO Types - No Any Leakage
// ============================================================================

// Action.verb should be string, not any
type ActionVerbIsNotAny = AssertNotAny<Action['verb']>
declare const actionVerbNotAny: ActionVerbIsNotAny
expectType<true>(actionVerbNotAny)

// Relationship properties should not be any
type RelationshipTypeIsNotAny = AssertNotAny<Relationship['type']>
declare const relationshipTypeNotAny: RelationshipTypeIsNotAny
expectType<true>(relationshipTypeNotAny)

// ObjectRef properties should not be any
type ObjectRefIdIsNotAny = AssertNotAny<ObjectRef['$id']>
declare const objectRefIdNotAny: ObjectRefIdIsNotAny
expectType<true>(objectRefIdNotAny)

// ============================================================================
// WorkflowContext Types - No Any Leakage
// ============================================================================

// WorkflowContext.track should have proper types
declare const ctx: WorkflowContext
type CtxTrackIsNotAny = AssertNotAny<WorkflowContext['track']>
declare const ctxTrackNotAny: CtxTrackIsNotAny
expectType<true>(ctxTrackNotAny)

// WorkflowContext.send should have proper types
type CtxSendIsNotAny = AssertNotAny<WorkflowContext['send']>
declare const ctxSendNotAny: CtxSendIsNotAny
expectType<true>(ctxSendNotAny)

// ============================================================================
// Collection Types - No Any Leakage
// ============================================================================

// Collection.$id should be string, not any
type CollectionIdIsNotAny = AssertNotAny<Collection['$id']>
declare const collectionIdNotAny: CollectionIdIsNotAny
expectType<true>(collectionIdNotAny)

// CollectionData.$type should be string literal, not any
type CollectionDataTypeIsNotAny = AssertNotAny<CollectionData['$type']>
declare const collectionDataTypeNotAny: CollectionDataTypeIsNotAny
expectType<true>(collectionDataTypeNotAny)

// ============================================================================
// Worker/Agent Types - No Any Leakage
// ============================================================================

// Task.id should be string, not any
type TaskIdIsNotAny = AssertNotAny<Task['id']>
declare const taskIdNotAny: TaskIdIsNotAny
expectType<true>(taskIdNotAny)

// TaskResult.taskId should be string, not any
type TaskResultIdIsNotAny = AssertNotAny<TaskResult['taskId']>
declare const taskResultIdNotAny: TaskResultIdIsNotAny
expectType<true>(taskResultIdNotAny)

// ============================================================================
// MCP Types - No Any Leakage
// ============================================================================

// McpTool.name should be string, not any
type McpToolNameIsNotAny = AssertNotAny<McpTool['name']>
declare const mcpToolNameNotAny: McpToolNameIsNotAny
expectType<true>(mcpToolNameNotAny)

// McpToolResult.content should be properly typed, not any
type McpToolResultContentIsNotAny = AssertNotAny<McpToolResult['content']>
declare const mcpToolResultContentNotAny: McpToolResultContentIsNotAny
expectType<true>(mcpToolResultContentNotAny)

// ============================================================================
// Zod-Inferred Types Match Interface Types
// ============================================================================

// BranchInput should be structurally compatible with Branch
declare const branch: Branch
declare const branchInput: BranchInput
expectAssignable<BranchInput>(branch)

// FilterInput should be structurally compatible with Filter
declare const filter: Filter
declare const filterInput: FilterInput
expectAssignable<FilterInput>(filter)

// FlagInput should be structurally compatible with Flag
declare const flag: Flag
declare const flagInput: FlagInput
expectAssignable<FlagInput>(flag)

// ============================================================================
// Type Narrowing Required for Unknown Types
// ============================================================================

// When types are `unknown`, they should require narrowing before use
// This verifies the types are properly strict

// Filter.value is unknown - cannot be used directly as a number
declare const filterForNarrowing: Filter
// @ts-expect-error - unknown requires type narrowing
const _sumWithFilterValue: number = filterForNarrowing.value + 1

// Branch.payload value is unknown - cannot call methods directly
declare const branchForNarrowing: Branch
// @ts-expect-error - unknown requires type narrowing
const _payloadMethod = branchForNarrowing.payload?.key.toString()

// ============================================================================
// Verify Key Types Are Exported (Import Above Succeeds)
// ============================================================================

// If any of the imports at the top of this file fail,
// it means the type is not properly exported from types/index.ts

// These type checks verify the imports worked and types have expected shapes
expectType<string>(thing.$id)
expectType<string>(thing.$type)
expectType<string>(event.verb)
expectType<string>(event.source)
expectType<Date>(event.timestamp)
expectType<string>(flag.id)
expectType<string>(flag.key)
