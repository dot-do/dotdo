import { expectType, expectAssignable } from 'tsd'

/**
 * TDD RED Phase: Public API Type Export Completeness
 *
 * This test file verifies that all public types are properly exported
 * from the main types module. TypeScript review identified missing exports:
 *
 * Missing from types/index.ts:
 * - HandlerRegistration from workflows/on.ts (event handler metadata)
 * - PipelineExpression from workflows/pipeline-promise.ts (pipeline AST)
 *
 * These types should be importable directly from '../index' (types/index.ts)
 * for consumers who want a unified type import.
 *
 * Issue: do-4prm (RED phase)
 *
 * Expected: These imports will FAIL until the types are re-exported
 * from types/index.ts.
 */

// ============================================================================
// Core Types - Should Already Be Exported (Baseline)
// ============================================================================

import type {
  // Core entity types - SHOULD WORK
  Thing,
  ThingData,

  // Noun/Verb types - SHOULD WORK
  Noun,
  NounData,

  // Event types - SHOULD WORK
  DomainEvent,
  EventHandler,

  // WorkflowContext types - SHOULD WORK
  WorkflowContext,
  OnProxy,
  ScheduleBuilder,
  DomainProxy,
  DOFunction,
} from '../index'

/**
 * Test: Core types are exported and have expected shapes
 */

// Thing type should have $id and $type properties
declare const thing: Thing
expectType<string>(thing.$id)
expectType<string>(thing.$type)

// ThingData should be assignable to Thing
declare const thingData: ThingData
expectAssignable<Thing>(thingData as Thing)

// DomainEvent should have verb, source, and timestamp
declare const event: DomainEvent
expectType<string>(event.verb)
expectType<string>(event.source)
expectType<Date>(event.timestamp)

// WorkflowContext should have execution methods
declare const ctx: WorkflowContext
expectType<(event: string, data: unknown) => void>(ctx.track)
expectType<(event: string, data: unknown) => string>(ctx.send as (event: string, data: unknown) => string)

// OnProxy and ScheduleBuilder should exist
declare const onProxy: OnProxy
declare const scheduleBuilder: ScheduleBuilder

// ============================================================================
// Missing Workflow Types - These SHOULD FAIL Until Exported
// ============================================================================

/**
 * Test: HandlerRegistration should be exported from types/index.ts
 *
 * HandlerRegistration is defined in workflows/on.ts and contains metadata
 * about registered event handlers:
 * - handler: Function
 * - eventKey: string
 * - context?: string
 * - registeredAt: number
 *
 * This type is useful for consumers who need to inspect or manage handlers.
 */

// @ts-expect-error - HandlerRegistration is not exported from types/index.ts
import type { HandlerRegistration as TypesHandlerRegistration } from '../index'

// When exported, this should work:
// declare const registration: TypesHandlerRegistration
// expectType<Function>(registration.handler)
// expectType<string>(registration.eventKey)
// expectType<number>(registration.registeredAt)

/**
 * Test: PipelineExpression should be exported from types/index.ts
 *
 * PipelineExpression is defined in workflows/pipeline-types.ts and represents
 * the AST for pipeline operations:
 * - { type: 'call', domain, method, context, args }
 * - { type: 'property', base, property }
 * - { type: 'map', array, mapper }
 * - { type: 'conditional', condition, thenBranch, elseBranch }
 * - { type: 'literal', value }
 * - etc.
 *
 * This type is essential for consumers building workflow analyzers or tools.
 */

// @ts-expect-error - PipelineExpression is not exported from types/index.ts
import type { PipelineExpression as TypesPipelineExpression } from '../index'

// When exported, this should work:
// declare const expr: TypesPipelineExpression
// Type guards would narrow the union type

/**
 * Test: PipelinePromise should be exported from types/index.ts
 *
 * PipelinePromise is the core type for lazy/deferred pipeline execution.
 * It's a Promise with captured expression metadata.
 */

// @ts-expect-error - PipelinePromise is not exported from types/index.ts
import type { PipelinePromise as TypesPipelinePromise } from '../index'

// When exported, this should work:
// declare const pipeline: TypesPipelinePromise<string>
// expectType<PipelineExpression>(pipeline.__expr)

/**
 * Test: WorkflowProxyOptions should be exported from types/index.ts
 *
 * WorkflowProxyOptions configures the $ workflow proxy:
 * - execute?: (expr: PipelineExpression) => Promise<unknown>
 * - onExecute?: (expr: PipelineExpression) => void
 */

// @ts-expect-error - WorkflowProxyOptions is not exported from types/index.ts
import type { WorkflowProxyOptions as TypesWorkflowProxyOptions } from '../index'

// ============================================================================
// Additional Missing Types Discovered During Review
// ============================================================================

/**
 * Test: MapperInstruction should be exported from types/index.ts
 *
 * MapperInstruction is used in 'map' expressions for recording
 * the transformation to apply to each element.
 */

// @ts-expect-error - MapperInstruction is not exported from types/index.ts
import type { MapperInstruction as TypesMapperInstruction } from '../index'

/**
 * Test: Unsubscribe should be exported from types/index.ts
 *
 * Unsubscribe is the return type of event handler registration,
 * allowing handlers to be removed.
 */

// @ts-expect-error - Unsubscribe is not exported from types/index.ts
import type { Unsubscribe as TypesUnsubscribe } from '../index'

/**
 * Test: OnHandlerOptions should be exported from types/index.ts
 *
 * OnHandlerOptions provides configuration for event handler registration.
 */

// @ts-expect-error - OnHandlerOptions is not exported from types/index.ts
import type { OnHandlerOptions as TypesOnHandlerOptions } from '../index'

/**
 * Test: EveryHandlerOptions should be exported from types/index.ts
 *
 * EveryHandlerOptions provides configuration for schedule handler registration.
 */

// @ts-expect-error - EveryHandlerOptions is not exported from types/index.ts
import type { EveryHandlerOptions as TypesEveryHandlerOptions } from '../index'

// ============================================================================
// Verify Types From Workflows Module Are Available (Workaround Import)
// ============================================================================

/**
 * These imports verify the types DO exist in workflows, they're just
 * not re-exported from types/index.ts yet.
 *
 * This serves as documentation of what SHOULD be exported.
 */

import type {
  HandlerRegistration,
  PipelineExpression,
  PipelinePromise,
  WorkflowProxyOptions,
  MapperInstruction,
  Unsubscribe,
  OnHandlerOptions,
  EveryHandlerOptions,
} from '../../workflows'

// Verify the types have expected shapes when imported from workflows
declare const workflowsHandlerReg: HandlerRegistration
expectType<Function>(workflowsHandlerReg.handler)
expectType<string>(workflowsHandlerReg.eventKey)
expectType<number>(workflowsHandlerReg.registeredAt)

declare const workflowsPipelineExpr: PipelineExpression
// Union type - can be narrowed with type guards
expectType<'call' | 'property' | 'map' | 'conditional' | 'branch' | 'match' | 'waitFor' | 'literal' | 'placeholder'>(workflowsPipelineExpr.type)

declare const workflowsPipelinePromise: PipelinePromise<string>
expectType<PipelineExpression>(workflowsPipelinePromise.__expr)
expectType<true>(workflowsPipelinePromise.__isPipelinePromise)

declare const workflowsUnsubscribe: Unsubscribe
expectType<() => boolean>(workflowsUnsubscribe)

// ============================================================================
// Summary of Required Changes
// ============================================================================

/**
 * To make these tests pass (GREEN phase), types/index.ts needs to add:
 *
 * ```typescript
 * // Pipeline and workflow types from workflows module
 * export type {
 *   HandlerRegistration,
 *   PipelineExpression,
 *   PipelinePromise,
 *   WorkflowProxyOptions,
 *   MapperInstruction,
 *   Unsubscribe,
 *   OnHandlerOptions,
 *   EveryHandlerOptions,
 * } from '../workflows'
 * ```
 *
 * Or alternatively, re-export from the individual files:
 *
 * ```typescript
 * export type { HandlerRegistration, Unsubscribe, OnHandlerOptions, EveryHandlerOptions } from '../workflows/on'
 * export type { PipelineExpression, PipelinePromise, WorkflowProxyOptions, MapperInstruction } from '../workflows/pipeline-types'
 * ```
 */
