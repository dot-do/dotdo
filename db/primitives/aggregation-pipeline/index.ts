/**
 * Aggregation Pipeline - MongoDB-style stage-based data processing
 *
 * Provides a type-safe, composable pipeline for data transformations with:
 * - Stage interface for custom transformations
 * - PipelineBuilder for fluent API construction
 * - Built-in stages: $match, $group, $project, $sort, $limit, $skip
 * - CUBE/ROLLUP for multi-dimensional analytics
 * - Streaming mode integration with WindowManager
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown during stage validation
 */
export class StageValidationError extends Error {
  public readonly stageName?: string

  constructor(message: string, stageName?: string) {
    super(message)
    this.name = 'StageValidationError'
    this.stageName = stageName
  }
}

/**
 * Error thrown during pipeline execution
 */
export class PipelineExecutionError extends Error {
  public readonly stageName: string
  public readonly stageIndex: number
  public readonly inputSnapshot?: unknown[]
  public readonly cause?: Error

  constructor(
    message: string,
    stageName: string,
    stageIndex: number,
    options?: { inputSnapshot?: unknown[]; cause?: Error }
  ) {
    super(message)
    this.name = 'PipelineExecutionError'
    this.stageName = stageName
    this.stageIndex = stageIndex
    this.inputSnapshot = options?.inputSnapshot
    this.cause = options?.cause
  }
}

// ============================================================================
// Stage Interface
// ============================================================================

/**
 * A pipeline stage that transforms input data to output data
 */
export interface Stage<TInput = unknown, TOutput = unknown> {
  /** Unique name identifying this stage */
  name: string

  /** Optional description for documentation */
  description?: string

  /** Optional version string */
  version?: string

  /** Optional tags for categorization */
  tags?: string[]

  /**
   * Process an array of input elements and return transformed output
   */
  process(input: TInput[]): TOutput[]

  /**
   * Optional validation function called before process
   * Should throw StageValidationError if input is invalid
   */
  validate?(input: TInput[]): void
}

// ============================================================================
// Pipeline Types
// ============================================================================

export interface PipelineOptions {
  name?: string
}

/**
 * A pipeline that chains multiple stages together
 */
export interface Pipeline<TInput = unknown, TOutput = unknown> {
  /** Pipeline name */
  name?: string

  /** Array of stages in execution order */
  stages: Stage<unknown, unknown>[]

  /**
   * Execute the pipeline on input data
   */
  execute(input: TInput[]): TOutput[]

  /**
   * Add a stage to the pipeline (returns new immutable pipeline)
   */
  addStage<TNewOutput>(stage: Stage<TOutput, TNewOutput>): Pipeline<TInput, TNewOutput>

  /**
   * Compose this pipeline with another
   */
  compose<TFinalOutput>(other: Pipeline<TOutput, TFinalOutput>): Pipeline<TInput, TFinalOutput>
}

// ============================================================================
// Pipeline Implementation
// ============================================================================

class PipelineImpl<TInput, TOutput> implements Pipeline<TInput, TOutput> {
  public readonly name?: string
  public readonly stages: Stage<unknown, unknown>[]

  constructor(stages: Stage<unknown, unknown>[] = [], options?: PipelineOptions) {
    this.stages = stages
    this.name = options?.name
  }

  execute(input: TInput[]): TOutput[] {
    let current: unknown[] = input

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i]!

      try {
        // Run validation if defined
        if (stage.validate) {
          try {
            stage!.validate(current)
          } catch (e) {
            if (e instanceof StageValidationError) {
              // Attach stage name if not already set
              if (!e.stageName) {
                throw new StageValidationError(e.message, stage!.name)
              }
              throw e
            }
            throw e
          }
        }

        // Process the stage
        current = stage!.process(current)
      } catch (e) {
        if (e instanceof StageValidationError) {
          throw e
        }
        if (e instanceof PipelineExecutionError) {
          throw e
        }
        throw new PipelineExecutionError(
          `Stage '${stage!.name}' failed: ${e instanceof Error ? e.message : String(e)}`,
          stage!.name,
          i,
          {
            inputSnapshot: current.slice(0, 10), // Keep first 10 for debugging
            cause: e instanceof Error ? e : undefined,
          }
        )
      }
    }

    return current as TOutput[]
  }

  addStage<TNewOutput>(stage: Stage<TOutput, TNewOutput>): Pipeline<TInput, TNewOutput> {
    // Check for duplicate stage names
    if (this.stages.some((s) => s.name === stage.name)) {
      throw new Error(`Duplicate stage name: ${stage.name}`)
    }

    return new PipelineImpl<TInput, TNewOutput>(
      [...this.stages, stage as Stage<unknown, unknown>],
      { name: this.name }
    )
  }

  compose<TFinalOutput>(other: Pipeline<TOutput, TFinalOutput>): Pipeline<TInput, TFinalOutput> {
    return new PipelineImpl<TInput, TFinalOutput>(
      [...this.stages, ...other.stages],
      { name: this.name }
    )
  }
}

// ============================================================================
// Pipeline Factory
// ============================================================================

/**
 * Create a new pipeline
 */
export function createPipeline<TInput, TOutput = TInput>(
  optionsOrStages?: PipelineOptions | Stage<unknown, unknown>[]
): Pipeline<TInput, TOutput> {
  if (Array.isArray(optionsOrStages)) {
    return new PipelineImpl<TInput, TOutput>(optionsOrStages)
  }
  return new PipelineImpl<TInput, TOutput>([], optionsOrStages)
}

// ============================================================================
// PipelineBuilder
// ============================================================================

// Import stage creators (will be defined in stages/)
import { createMatchStage, MatchPredicate } from './stages/match'
import { createGroupStage, GroupSpec } from './stages/group'
import { createProjectStage, ProjectSpec } from './stages/project'
import { createSortStage, createLimitStage, createSkipStage, SortSpec, SortOptions } from './stages/sort-limit'

/**
 * Fluent builder for constructing pipelines with MongoDB-style stages
 */
export class PipelineBuilder<TInput, TOutput = TInput> {
  private stages: Stage<unknown, unknown>[] = []

  /**
   * Add a $match stage for filtering
   */
  match(predicate: MatchPredicate<TOutput>): PipelineBuilder<TInput, TOutput> {
    const stage = createMatchStage<TOutput>(predicate)
    this.stages.push(stage as Stage<unknown, unknown>)
    return this
  }

  /**
   * Add a $group stage for aggregation
   */
  group<TGroupResult>(spec: GroupSpec<TOutput>): PipelineBuilder<TInput, TGroupResult> {
    const stage = createGroupStage<TOutput>(spec)
    this.stages.push(stage as Stage<unknown, unknown>)
    return this as unknown as PipelineBuilder<TInput, TGroupResult>
  }

  /**
   * Add a $project stage for field selection/transformation
   */
  project<TProjectResult>(spec: ProjectSpec<TOutput>): PipelineBuilder<TInput, TProjectResult> {
    const stage = createProjectStage<TOutput>(spec)
    this.stages.push(stage as Stage<unknown, unknown>)
    return this as unknown as PipelineBuilder<TInput, TProjectResult>
  }

  /**
   * Add a $sort stage
   */
  sort(spec: SortSpec<TOutput>, options?: SortOptions): PipelineBuilder<TInput, TOutput> {
    const stage = createSortStage<TOutput>(spec, options)
    this.stages.push(stage as Stage<unknown, unknown>)
    return this
  }

  /**
   * Add a $limit stage
   */
  limit(n: number): PipelineBuilder<TInput, TOutput> {
    const stage = createLimitStage<TOutput>(n)
    this.stages.push(stage as Stage<unknown, unknown>)
    return this
  }

  /**
   * Add a $skip stage
   */
  skip(n: number): PipelineBuilder<TInput, TOutput> {
    const stage = createSkipStage<TOutput>(n)
    this.stages.push(stage as Stage<unknown, unknown>)
    return this
  }

  /**
   * Add a custom stage
   */
  addStage<TNewOutput>(stage: Stage<TOutput, TNewOutput>): PipelineBuilder<TInput, TNewOutput> {
    this.stages.push(stage as Stage<unknown, unknown>)
    return this as unknown as PipelineBuilder<TInput, TNewOutput>
  }

  /**
   * Build the pipeline
   */
  build(): Pipeline<TInput, TOutput> {
    return new PipelineImpl<TInput, TOutput>(this.stages)
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { createMatchStage } from './stages/match'
export type { MatchPredicate, MatchStage, CompoundPredicate, FieldPredicate } from './stages/match'
export { createGroupStage } from './stages/group'
export type { GroupSpec, GroupStage, Accumulator, AccumulatorType, GroupKey, GroupResult } from './stages/group'
export { createProjectStage } from './stages/project'
export type { ProjectSpec, ProjectStage, FieldProjection, ComputedField } from './stages/project'
export { createSortStage, createLimitStage, createSkipStage } from './stages/sort-limit'
export type { SortSpec, SortStage, LimitStage, SkipStage, SortDirection, NullPosition, SortOptions, LimitOptions } from './stages/sort-limit'
export { createCubeStage, createRollupStage, createGroupingSetsStage, grouping, groupingId } from './stages/cube-rollup'
export type { CubeStage, RollupStage, GroupingSetsStage, CubeSpec, RollupSpec, GroupingSetsSpec } from './stages/cube-rollup'
export { createStreamingPipeline } from './streaming'
export type { StreamingPipeline, StreamingPipelineOptions, WindowedAggregation, IncrementalResult, LateDataOutput, CheckpointState } from './streaming'
