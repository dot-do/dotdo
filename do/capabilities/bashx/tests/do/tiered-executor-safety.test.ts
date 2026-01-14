/**
 * Tests for TieredExecutor Safety Integration
 *
 * Verifies that multi-language safety analysis is integrated into tier classification:
 * - Non-bash languages get SandboxStrategy in classification result
 * - Dangerous patterns influence sandbox resource limits
 * - Bash commands don't include sandboxStrategy (not needed)
 *
 * @module bashx/tests/do/tiered-executor-safety
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TieredExecutor,
  type TierClassification,
} from '../../src/do/tiered-executor.js'
import type { SandboxStrategy } from '../../core/safety/multi-language.js'
import type { BashResult, FsCapability } from '../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockFsCapability(): FsCapability {
  return {
    read: async () => 'test content',
    exists: async () => true,
    list: async () => [],
    stat: async () => ({
      size: 0,
      isDirectory: () => false,
      isFile: () => true,
      mode: 0o644,
      uid: 0,
      gid: 0,
      nlink: 1,
      dev: 0,
      ino: 0,
      rdev: 0,
      blksize: 4096,
      blocks: 0,
      atimeMs: Date.now(),
      mtimeMs: Date.now(),
      ctimeMs: Date.now(),
      birthtimeMs: Date.now(),
    }),
  } as unknown as FsCapability
}

function createMockSandbox() {
  return {
    execute: async (command: string): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `sandbox: ${command}\n`,
      stderr: '',
      exitCode: 0,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: 'Executed via sandbox',
      },
    }),
  }
}

// ============================================================================
// SAFETY INTEGRATION TESTS
// ============================================================================

describe('TieredExecutor - Safety Integration', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('SandboxStrategy in Classification', () => {
    it('includes sandboxStrategy for dangerous Python code routed to sandbox', () => {
      // Python with eval() - dangerous pattern, routes to Tier 4 sandbox
      // when no python worker is available
      const classification = executor.classifyCommand('python -c "eval(user_input)"')

      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
      expect(classification.sandboxStrategy).toBeDefined()
      expect(classification.sandboxStrategy?.network).toBe('none')
      expect(classification.sandboxStrategy?.filesystem).toBe('read-only')
    })

    it('includes sandboxStrategy for Python subprocess execution', () => {
      // Python with subprocess.run - system execution pattern
      const classification = executor.classifyCommand('python -c "import subprocess; subprocess.run([\'rm\', \'-rf\', \'/\'])"')

      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
      expect(classification.sandboxStrategy).toBeDefined()
      // System execution patterns should get restricted resources
      expect(classification.sandboxStrategy?.timeout).toBeLessThanOrEqual(10000)
    })

    it('includes sandboxStrategy for Ruby system() calls', () => {
      // Ruby with system() - dangerous system call pattern
      const classification = executor.classifyCommand('ruby -e "system(\'rm -rf /\')"')

      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
      expect(classification.sandboxStrategy).toBeDefined()
      expect(classification.sandboxStrategy?.network).toBe('none')
    })

    it('includes sandboxStrategy for Node.js child_process', () => {
      // Node.js with child_process - system execution pattern
      const classification = executor.classifyCommand('node -e "require(\'child_process\').exec(\'rm -rf /\')"')

      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
      expect(classification.sandboxStrategy).toBeDefined()
    })

    it('provides appropriate resource limits based on danger level', () => {
      // High-danger code should have restrictive limits
      const dangerousClassification = executor.classifyCommand('python -c "os.system(\'rm -rf /\')"')

      expect(dangerousClassification.sandboxStrategy).toBeDefined()
      expect(dangerousClassification.sandboxStrategy!.resources.memoryMB).toBeLessThanOrEqual(128)
      expect(dangerousClassification.sandboxStrategy!.timeout).toBeLessThanOrEqual(10000)
    })

    it('provides relaxed limits for safe code', () => {
      // Safe Python code should have more permissive limits
      const safeClassification = executor.classifyCommand('python -c "print(2 + 2)"')

      expect(safeClassification.sandboxStrategy).toBeDefined()
      // Safe code gets more resources
      expect(safeClassification.sandboxStrategy!.resources.memoryMB).toBeGreaterThanOrEqual(256)
      expect(safeClassification.sandboxStrategy!.timeout).toBeGreaterThanOrEqual(30000)
    })
  })

  describe('Bash commands - no sandboxStrategy needed', () => {
    it('does NOT include sandboxStrategy for bash Tier 1 commands', () => {
      const classification = executor.classifyCommand('echo hello world')

      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      // Bash commands don't need sandboxStrategy - they use AST-based analysis
      expect(classification.sandboxStrategy).toBeUndefined()
    })

    it('does NOT include sandboxStrategy for bash filesystem commands', () => {
      const classification = executor.classifyCommand('cat /etc/passwd')

      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.sandboxStrategy).toBeUndefined()
    })

    it('does NOT include sandboxStrategy for bash Tier 4 commands', () => {
      // Docker is a bash command that goes to Tier 4
      const classification = executor.classifyCommand('docker ps')

      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
      // Even bash commands in Tier 4 don't need sandboxStrategy
      // because they use bash-specific AST analysis
      expect(classification.sandboxStrategy).toBeUndefined()
    })
  })

  describe('SandboxStrategy reflects detected patterns', () => {
    it('restricts network for code with system execution patterns', () => {
      // Code that actually calls subprocess.run should have restricted network
      // (just importing subprocess without calling it is not dangerous)
      const classification = executor.classifyCommand('python -c "subprocess.run([\'ls\'])"')

      expect(classification.sandboxStrategy).toBeDefined()
      // Code that spawns subprocesses should have restricted network
      expect(classification.sandboxStrategy?.network).not.toBe('unrestricted')
    })

    it('restricts filesystem for code with code execution patterns', () => {
      // Code using eval should have restricted filesystem
      const classification = executor.classifyCommand('ruby -e "eval(gets)"')

      expect(classification.sandboxStrategy).toBeDefined()
      expect(classification.sandboxStrategy?.filesystem).not.toBe('unrestricted')
    })
  })
})
