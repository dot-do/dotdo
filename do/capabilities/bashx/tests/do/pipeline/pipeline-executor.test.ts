/**
 * Tests for PipelineExecutor
 *
 * Verifies pipeline orchestration capabilities:
 * - Splitting commands by pipe character (respecting quotes)
 * - Sequential execution with stdout/stdin chaining
 * - Early termination on non-zero exit codes
 * - Single command passthrough
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineExecutor } from '../../../src/do/pipeline/pipeline-executor.js'
import type { BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock BashResult for testing
 */
function createMockResult(
  input: string,
  stdout: string,
  stderr: string = '',
  exitCode: number = 0
): BashResult {
  return {
    input,
    command: input,
    stdout,
    stderr,
    exitCode,
    valid: true,
    generated: false,
    intent: {
      commands: [],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
    classification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Test mock',
    },
  }
}

/**
 * Create a mock command executor function
 */
function createMockExecutor(
  results: Map<string, BashResult>
): (cmd: string, opts?: ExecOptions) => Promise<BashResult> {
  return async (cmd: string, opts?: ExecOptions): Promise<BashResult> => {
    // If there's stdin, append it to the command lookup key
    const key = opts?.stdin ? `${cmd}|stdin:${opts.stdin}` : cmd
    const result = results.get(key) || results.get(cmd)
    if (result) {
      return result
    }
    // Default fallback for unregistered commands
    return createMockResult(cmd, '', `Command not found: ${cmd}`, 127)
  }
}

// ============================================================================
// SPLITPIPELINE TESTS
// ============================================================================

describe('PipelineExecutor', () => {
  describe('splitPipeline', () => {
    let executor: PipelineExecutor

    beforeEach(() => {
      // Create with a dummy executor for split tests
      executor = new PipelineExecutor(async () => createMockResult('', ''))
    })

    it('splits a simple two-command pipeline', () => {
      const result = executor.splitPipeline('ls | grep foo')
      expect(result).toEqual(['ls', 'grep foo'])
    })

    it('splits a three-command pipeline', () => {
      const result = executor.splitPipeline('cat file.txt | sort | uniq')
      expect(result).toEqual(['cat file.txt', 'sort', 'uniq'])
    })

    it('handles single command (no pipe)', () => {
      const result = executor.splitPipeline('echo hello')
      expect(result).toEqual(['echo hello'])
    })

    it('preserves pipes inside single quotes', () => {
      const result = executor.splitPipeline("echo 'a | b' | cat")
      expect(result).toEqual(["echo 'a | b'", 'cat'])
    })

    it('preserves pipes inside double quotes', () => {
      const result = executor.splitPipeline('echo "a | b" | cat')
      expect(result).toEqual(['echo "a | b"', 'cat'])
    })

    it('does not split on logical OR (||)', () => {
      const result = executor.splitPipeline('cmd1 || cmd2')
      expect(result).toEqual(['cmd1 || cmd2'])
    })

    it('handles escaped pipes', () => {
      const result = executor.splitPipeline('echo a\\|b | cat')
      expect(result).toEqual(['echo a\\|b', 'cat'])
    })

    it('handles empty input', () => {
      const result = executor.splitPipeline('')
      expect(result).toEqual([])
    })

    it('handles whitespace only input', () => {
      const result = executor.splitPipeline('   ')
      expect(result).toEqual([])
    })

    it('trims whitespace from segments', () => {
      const result = executor.splitPipeline('  ls  |  grep foo  ')
      expect(result).toEqual(['ls', 'grep foo'])
    })
  })

  // ============================================================================
  // EXECUTE TESTS
  // ============================================================================

  describe('execute', () => {
    it('executes a simple pipeline with stdout chaining', async () => {
      const results = new Map<string, BashResult>()
      results.set('echo hello', createMockResult('echo hello', 'hello\n'))
      results.set('cat|stdin:hello\n', createMockResult('cat', 'hello\n'))

      const mockExecutor = createMockExecutor(results)
      const pipeline = new PipelineExecutor(mockExecutor)

      const result = await pipeline.execute('echo hello | cat')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello\n')
    })

    it('chains stdout to stdin across multiple commands', async () => {
      const results = new Map<string, BashResult>()
      results.set('echo "line1\nline2\nline3"', createMockResult('echo', 'line1\nline2\nline3\n'))
      results.set('sort|stdin:line1\nline2\nline3\n', createMockResult('sort', 'line1\nline2\nline3\n'))
      results.set('head -1|stdin:line1\nline2\nline3\n', createMockResult('head -1', 'line1\n'))

      const mockExecutor = createMockExecutor(results)
      const pipeline = new PipelineExecutor(mockExecutor)

      const result = await pipeline.execute('echo "line1\nline2\nline3" | sort | head -1')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line1\n')
    })

    it('stops pipeline on non-zero exit code (early termination)', async () => {
      const executorFn = vi.fn()
      executorFn
        .mockResolvedValueOnce(createMockResult('cmd1', '', 'error', 1))
        .mockResolvedValueOnce(createMockResult('cmd2', 'output'))

      const pipeline = new PipelineExecutor(executorFn)

      const result = await pipeline.execute('cmd1 | cmd2')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('error')
      // Second command should NOT be called
      expect(executorFn).toHaveBeenCalledTimes(1)
    })

    it('executes single command without splitting', async () => {
      const executorFn = vi.fn().mockResolvedValue(createMockResult('ls -la', 'file1\nfile2\n'))
      const pipeline = new PipelineExecutor(executorFn)

      const result = await pipeline.execute('ls -la')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('file1\nfile2\n')
      expect(executorFn).toHaveBeenCalledTimes(1)
      expect(executorFn).toHaveBeenCalledWith('ls -la', expect.anything())
    })

    it('passes initial stdin through to first command', async () => {
      const executorFn = vi.fn().mockResolvedValue(createMockResult('cat', 'initial input'))
      const pipeline = new PipelineExecutor(executorFn)

      await pipeline.execute('cat', { stdin: 'initial input' })

      expect(executorFn).toHaveBeenCalledWith('cat', expect.objectContaining({
        stdin: 'initial input',
      }))
    })

    it('preserves other options through pipeline execution', async () => {
      const executorFn = vi.fn().mockResolvedValue(createMockResult('cmd', 'output'))
      const pipeline = new PipelineExecutor(executorFn)

      await pipeline.execute('cmd1 | cmd2', {
        cwd: '/tmp',
        timeout: 5000,
        env: { FOO: 'bar' },
      })

      expect(executorFn).toHaveBeenCalledWith('cmd1', expect.objectContaining({
        cwd: '/tmp',
        timeout: 5000,
        env: { FOO: 'bar' },
      }))
    })

    it('handles empty pipeline gracefully', async () => {
      const executorFn = vi.fn()
      const pipeline = new PipelineExecutor(executorFn)

      const result = await pipeline.execute('')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(executorFn).not.toHaveBeenCalled()
    })

    it('handles pipeline with only whitespace', async () => {
      const executorFn = vi.fn()
      const pipeline = new PipelineExecutor(executorFn)

      const result = await pipeline.execute('   ')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(executorFn).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles complex nested quotes', () => {
      const pipeline = new PipelineExecutor(async () => createMockResult('', ''))

      // Double quotes containing single quotes
      const result1 = pipeline.splitPipeline('echo "it\'s | fine" | cat')
      expect(result1).toEqual(['echo "it\'s | fine"', 'cat'])

      // Single quotes containing double quotes
      const result2 = pipeline.splitPipeline("echo 'say \"hi | there\"' | cat")
      expect(result2).toEqual(["echo 'say \"hi | there\"'", 'cat'])
    })

    it('handles mixed || and | operators', () => {
      const pipeline = new PipelineExecutor(async () => createMockResult('', ''))

      const result = pipeline.splitPipeline('cmd1 || cmd2 | cmd3')
      expect(result).toEqual(['cmd1 || cmd2', 'cmd3'])
    })

    it('handles consecutive pipes correctly', () => {
      const pipeline = new PipelineExecutor(async () => createMockResult('', ''))

      // This is technically invalid bash, but we should handle it gracefully
      const result = pipeline.splitPipeline('cmd1 | | cmd2')
      // Empty segment between pipes should be filtered out
      expect(result).toEqual(['cmd1', 'cmd2'])
    })
  })
})
