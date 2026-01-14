/**
 * Pipeline Execution Module
 *
 * Provides the PipelineExecutor for orchestrating pipeline command execution.
 * This module separates pipeline orchestration from command execution,
 * following the composite pattern.
 *
 * Architecture:
 * -------------
 * - pipeline-executor.ts: Pipeline splitting and execution orchestration
 *
 * The PipelineExecutor:
 * - Parses pipeline commands respecting shell quoting rules
 * - Chains stdout/stdin between pipeline stages
 * - Provides early termination on non-zero exit codes
 * - Works with any command executor function
 *
 * Usage:
 * ------
 * ```typescript
 * import { PipelineExecutor } from './pipeline/index.js'
 *
 * const pipeline = new PipelineExecutor(async (cmd, opts) => {
 *   // Your command execution logic
 *   return await executor.execute(cmd, opts)
 * })
 *
 * const result = await pipeline.execute('ls | grep foo | wc -l')
 * ```
 *
 * @module bashx/do/pipeline
 */

// ============================================================================
// PIPELINE EXECUTOR
// ============================================================================
// Handles pipeline orchestration:
// - Splitting commands by | (respecting quotes)
// - Chaining stdout/stdin between stages
// - Early termination on error
// ============================================================================
export { PipelineExecutor, type CommandExecutor } from './pipeline-executor.js'
