/**
 * Tool Adapters for Claude Agent SDK
 *
 * This module provides adapters that map Claude SDK tools (Read, Write, Edit, Glob, Grep, Bash)
 * to dotdo's extended primitives (fsx.do, bashx.do, gitx.do).
 *
 * Architecture:
 * - Read/Write/Edit/Glob/Grep -> fsx.do (FsCapability)
 * - Bash -> bashx.do (BashCapability with TieredExecutor)
 *
 * @see https://docs.anthropic.com/claude/docs/tool-use
 * @module agents/tools
 */

// Tool adapter exports will be added here as implementations are completed
// Currently in RED phase - tests exist but implementations do not

/**
 * Phase 1 - Tool Adapters (RED -> GREEN -> REFACTOR)
 *
 * Issues:
 * - dotdo-7fqvc: Read tool adapter
 * - dotdo-oz7vg: Write tool adapter
 * - dotdo-j3e7q: Edit tool adapter
 * - dotdo-4a80a: Glob tool adapter
 * - dotdo-cleeq: Grep tool adapter
 * - dotdo-sla1o: Bash tool adapter
 */

// Placeholder exports - implementations pending
export const TOOL_ADAPTERS_STATUS = 'RED_PHASE' as const
