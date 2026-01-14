/**
 * MCP Bash Tool Tests (RED Phase)
 *
 * Tests for the single MCP 'bash' tool that provides:
 * - Command execution with safety analysis
 * - Natural language to command generation
 * - AST-based validation and classification
 * - Result formatting with undo capability
 *
 * These tests define expected behavior for the MCP bash tool.
 * They should fail initially (RED phase) until implementation is complete.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BASH_TOOL, getToolDefinition, handleBash } from '../../src/mcp/index.js'
import type { BashMcpTool, BashResult, SafetyClassification, Intent } from '../../src/types.js'

// ============================================================================
// Tool Schema Tests
// ============================================================================

describe('MCP Tool Schema Definition', () => {
  describe('Tool Metadata', () => {
    it('should export BASH_TOOL constant', () => {
      expect(BASH_TOOL).toBeDefined()
      expect(typeof BASH_TOOL).toBe('object')
    })

    it('should have name "bash"', () => {
      expect(BASH_TOOL.name).toBe('bash')
    })

    it('should have a description', () => {
      expect(BASH_TOOL.description).toBeDefined()
      expect(typeof BASH_TOOL.description).toBe('string')
      expect(BASH_TOOL.description.length).toBeGreaterThan(50)
    })

    it('should describe safety features in description', () => {
      const desc = BASH_TOOL.description.toLowerCase()
      expect(desc).toContain('safety')
    })

    it('should describe AST analysis in description', () => {
      const desc = BASH_TOOL.description.toLowerCase()
      expect(desc).toContain('ast')
    })
  })

  describe('Input Schema', () => {
    it('should have inputSchema property', () => {
      expect(BASH_TOOL.inputSchema).toBeDefined()
      expect(BASH_TOOL.inputSchema.type).toBe('object')
    })

    it('should define "input" property as required string', () => {
      const props = BASH_TOOL.inputSchema.properties
      expect(props.input).toBeDefined()
      expect(props.input.type).toBe('string')
      expect(BASH_TOOL.inputSchema.required).toContain('input')
    })

    it('should define "confirm" property as optional boolean', () => {
      const props = BASH_TOOL.inputSchema.properties
      expect(props.confirm).toBeDefined()
      expect(props.confirm.type).toBe('boolean')
      expect(BASH_TOOL.inputSchema.required).not.toContain('confirm')
    })

    it('should have descriptions for all properties', () => {
      const props = BASH_TOOL.inputSchema.properties
      expect(props.input.description).toBeDefined()
      expect(props.input.description.length).toBeGreaterThan(10)
      expect(props.confirm.description).toBeDefined()
      expect(props.confirm.description.length).toBeGreaterThan(10)
    })
  })

  describe('getToolDefinition()', () => {
    it('should return the tool definition', () => {
      const tool = getToolDefinition()
      expect(tool).toEqual(BASH_TOOL)
    })

    it('should return same reference each time', () => {
      const tool1 = getToolDefinition()
      const tool2 = getToolDefinition()
      expect(tool1).toBe(tool2)
    })
  })
})

// ============================================================================
// Tool Execution Tests
// ============================================================================

describe('MCP Tool Execution', () => {
  describe('handleBash() Basic Execution', () => {
    it('should be an async function', async () => {
      expect(typeof handleBash).toBe('function')
      const result = handleBash({ input: 'ls' })
      expect(result).toBeInstanceOf(Promise)
      // Verify the promise resolves successfully with the implementation
      await expect(result).resolves.toBeDefined()
    })

    it('should execute simple read-only commands', async () => {
      // This test should pass once backend is implemented
      const result = await handleBash({ input: 'ls' })

      expect(result).toBeDefined()
      expect(result.input).toBe('ls')
      expect(result.valid).toBe(true)
      expect(result.exitCode).toBe(0)
    })

    it('should return BashResult structure', async () => {
      const result = await handleBash({ input: 'pwd' })

      // Verify all required BashResult properties
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
    })

    it('should parse command into AST', async () => {
      const result = await handleBash({ input: 'echo hello' })

      expect(result.ast).toBeDefined()
      expect(result.ast?.type).toBe('Program')
      expect(result.ast?.body.length).toBeGreaterThan(0)
    })

    it('should handle commands with arguments', async () => {
      const result = await handleBash({ input: 'ls -la /tmp' })

      expect(result.valid).toBe(true)
      expect(result.command).toBe('ls -la /tmp')
    })

    it('should handle pipelines', async () => {
      const result = await handleBash({ input: 'cat package.json | grep name' })

      expect(result.valid).toBe(true)
      expect(result.intent.commands).toContain('cat')
      expect(result.intent.commands).toContain('grep')
    })

    it('should handle command lists (&&)', async () => {
      const result = await handleBash({ input: 'mkdir test && cd test' })

      expect(result.valid).toBe(true)
      expect(result.intent.commands).toContain('mkdir')
      expect(result.intent.commands).toContain('cd')
    })
  })

  describe('handleBash() Error Handling', () => {
    it('should handle invalid bash syntax', async () => {
      const result = await handleBash({ input: 'echo "unclosed' })

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should provide error suggestions', async () => {
      const result = await handleBash({ input: 'echo "test' })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].suggestion).toBeDefined()
    })

    it('should handle empty input', async () => {
      const result = await handleBash({ input: '' })

      expect(result.valid).toBe(true)
      expect(result.command).toBe('')
    })

    it('should handle whitespace-only input', async () => {
      const result = await handleBash({ input: '   ' })

      expect(result.valid).toBe(true)
      expect(result.command).toBe('')
    })

    it('should handle command execution errors', async () => {
      const result = await handleBash({ input: 'cat nonexistent-file-12345.txt' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeDefined()
      expect(result.stderr.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Safety Analysis Tests
// ============================================================================

describe('MCP Tool Safety Analysis', () => {
  describe('Pre-execution Safety Check', () => {
    it('should analyze command before execution', async () => {
      const result = await handleBash({ input: 'ls' })

      expect(result.classification).toBeDefined()
      expect(result.classification.type).toBeDefined()
      expect(result.classification.impact).toBeDefined()
      expect(result.classification.reversible).toBeDefined()
      expect(result.classification.reason).toBeDefined()
    })

    it('should classify read-only commands as safe', async () => {
      const result = await handleBash({ input: 'cat package.json' })

      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
      expect(result.classification.reversible).toBe(true)
    })

    it('should classify delete commands appropriately', async () => {
      const result = await handleBash({ input: 'rm file.txt' })

      expect(result.classification.type).toBe('delete')
      expect(result.classification.reversible).toBe(false)
    })

    it('should classify recursive delete as high impact', async () => {
      const result = await handleBash({ input: 'rm -r directory/' })

      expect(result.classification.type).toBe('delete')
      expect(result.classification.impact).toBe('high')
    })

    it('should classify network commands appropriately', async () => {
      const result = await handleBash({ input: 'curl https://example.com.ai' })

      expect(result.classification.type).toBe('network')
    })
  })

  describe('Critical Command Blocking', () => {
    it('should block critical commands by default', async () => {
      const result = await handleBash({ input: 'rm -rf /' })

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toBeDefined()
      expect(result.classification.impact).toBe('critical')
    })

    it('should block chmod on root with recursive', async () => {
      const result = await handleBash({ input: 'chmod -R 777 /' })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should block dd to device paths', async () => {
      const result = await handleBash({ input: 'dd if=/dev/zero of=/dev/sda' })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should allow critical commands with confirm=true', async () => {
      const result = await handleBash({
        input: 'rm -rf /tmp/safe-to-delete',
        confirm: true,
      })

      expect(result.blocked).not.toBe(true)
    })

    it('should not block safe commands', async () => {
      const result = await handleBash({ input: 'ls -la' })

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
    })
  })

  describe('Intent Extraction', () => {
    it('should extract intent from commands', async () => {
      const result = await handleBash({ input: 'cat file.txt' })

      expect(result.intent).toBeDefined()
      expect(result.intent.commands).toContain('cat')
      expect(result.intent.reads).toContain('file.txt')
    })

    it('should detect file reads', async () => {
      const result = await handleBash({ input: 'head -n 10 log.txt' })

      expect(result.intent.reads).toContain('log.txt')
    })

    it('should detect file writes from redirects', async () => {
      const result = await handleBash({ input: 'echo "test" > output.txt' })

      expect(result.intent.writes).toContain('output.txt')
    })

    it('should detect deletes', async () => {
      const result = await handleBash({ input: 'rm old-file.txt' })

      expect(result.intent.deletes).toContain('old-file.txt')
    })

    it('should detect network operations', async () => {
      const result = await handleBash({ input: 'wget https://example.com.ai/file.tar.gz' })

      expect(result.intent.network).toBe(true)
    })

    it('should detect elevated operations', async () => {
      const result = await handleBash({ input: 'sudo rm file.txt' })

      expect(result.intent.elevated).toBe(true)
    })
  })
})

// ============================================================================
// Result Formatting Tests
// ============================================================================

describe('MCP Tool Result Formatting', () => {
  describe('Successful Execution Result', () => {
    it('should include stdout', async () => {
      const result = await handleBash({ input: 'echo "hello world"' })

      expect(result.stdout).toBeDefined()
      expect(result.stdout).toContain('hello world')
    })

    it('should include exit code 0 for success', async () => {
      const result = await handleBash({ input: 'true' })

      expect(result.exitCode).toBe(0)
    })

    it('should include empty stderr for success', async () => {
      const result = await handleBash({ input: 'echo test' })

      expect(result.stderr).toBe('')
    })

    it('should mark command as not generated for direct input', async () => {
      const result = await handleBash({ input: 'ls' })

      expect(result.generated).toBe(false)
    })
  })

  describe('Failed Execution Result', () => {
    it('should include non-zero exit code for failure', async () => {
      const result = await handleBash({ input: 'exit 1' })

      expect(result.exitCode).toBe(1)
    })

    it('should include stderr for failures', async () => {
      const result = await handleBash({ input: 'ls nonexistent-directory-xyz' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    })
  })

  describe('Blocked Result', () => {
    it('should include blocked flag', async () => {
      const result = await handleBash({ input: 'rm -rf /' })

      expect(result.blocked).toBe(true)
    })

    it('should include requiresConfirm flag', async () => {
      const result = await handleBash({ input: 'rm -rf /' })

      expect(result.requiresConfirm).toBe(true)
    })

    it('should include blockReason', async () => {
      const result = await handleBash({ input: 'rm -rf /' })

      expect(result.blockReason).toBeDefined()
      expect(result.blockReason!.length).toBeGreaterThan(0)
    })

    it('should not execute blocked commands', async () => {
      const result = await handleBash({ input: 'rm -rf /' })

      expect(result.blocked).toBe(true)
      expect(result.stdout).toBe('')
      expect(result.exitCode).toBe(0) // Not executed, so no error
    })
  })

  describe('Undo Capability', () => {
    it('should include undo for reversible operations', async () => {
      // mv requires confirmation now that it's classified as dangerous
      const result = await handleBash({ input: 'mv old.txt new.txt', confirm: true })

      expect(result.undo).toBeDefined()
      expect(result.undo).toBe('mv new.txt old.txt')
    })

    it('should include undo for cp operations', async () => {
      const result = await handleBash({ input: 'cp source.txt dest.txt' })

      expect(result.undo).toBeDefined()
      expect(result.undo).toContain('rm')
      expect(result.undo).toContain('dest.txt')
    })

    it('should not include undo for irreversible operations', async () => {
      const result = await handleBash({ input: 'rm file.txt', confirm: true })

      expect(result.undo).toBeUndefined()
    })

    it('should not include undo for read-only operations', async () => {
      const result = await handleBash({ input: 'cat file.txt' })

      expect(result.undo).toBeUndefined()
    })
  })

  describe('Suggestions', () => {
    it('should include suggestions for syntax errors', async () => {
      const result = await handleBash({ input: 'if true' })

      expect(result.suggestions).toBeDefined()
      expect(result.suggestions!.length).toBeGreaterThan(0)
    })

    it('should include fix suggestions for unclosed quotes', async () => {
      const result = await handleBash({ input: 'echo "test' })

      expect(result.fixed).toBeDefined()
      expect(result.fixed?.command).toBe('echo "test"')
    })
  })
})

// ============================================================================
// Natural Language Input Tests
// ============================================================================

describe('MCP Tool Natural Language Input', () => {
  describe('Intent Detection', () => {
    it('should detect natural language input', async () => {
      const result = await handleBash({ input: 'list all files' })

      expect(result.generated).toBe(true)
    })

    it('should generate command from natural language', async () => {
      const result = await handleBash({ input: 'show me the current directory' })

      expect(result.generated).toBe(true)
      expect(result.command).toBeDefined()
      expect(result.command.length).toBeGreaterThan(0)
    })
  })

  describe('Command Generation', () => {
    it('should generate ls for "list files"', async () => {
      const result = await handleBash({ input: 'list files' })

      expect(result.generated).toBe(true)
      expect(result.command).toContain('ls')
    })

    it('should generate find for "find large files"', async () => {
      const result = await handleBash({ input: 'find large files' })

      expect(result.generated).toBe(true)
      expect(result.command).toContain('find')
    })

    it('should generate git status for "show git status"', async () => {
      const result = await handleBash({ input: 'show git status' })

      expect(result.generated).toBe(true)
      expect(result.command).toContain('git')
      expect(result.command).toContain('status')
    })

    it('should still perform safety analysis on generated commands', async () => {
      const result = await handleBash({ input: 'delete everything' })

      expect(result.generated).toBe(true)
      expect(result.classification).toBeDefined()
      expect(result.blocked).toBeDefined()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('MCP Tool Full Flow Integration', () => {
  describe('Parse -> Classify -> Execute Flow', () => {
    it('should complete full flow for safe command', async () => {
      const result = await handleBash({ input: 'ls -la' })

      // Step 1: Parse
      expect(result.valid).toBe(true)
      expect(result.ast).toBeDefined()

      // Step 2: Classify
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')

      // Step 3: No blocking for safe commands
      expect(result.blocked).toBeUndefined()

      // Step 4: Execute
      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('should complete flow for blocked command', async () => {
      const result = await handleBash({ input: 'rm -rf /' })

      // Step 1: Parse
      expect(result.valid).toBe(true)
      expect(result.ast).toBeDefined()

      // Step 2: Classify
      expect(result.classification.type).toBe('delete')
      expect(result.classification.impact).toBe('critical')

      // Step 3: Block
      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)

      // Step 4: NOT executed
      expect(result.stdout).toBe('')
    })

    it('should complete flow for confirmed dangerous command', async () => {
      const result = await handleBash({
        input: 'rm -rf /tmp/test-directory',
        confirm: true,
      })

      // Step 1: Parse
      expect(result.valid).toBe(true)

      // Step 2: Classify
      expect(result.classification.type).toBe('delete')

      // Step 3: No block with confirm
      expect(result.blocked).not.toBe(true)

      // Step 4: Executed (may fail if directory doesn't exist)
      expect(result.exitCode).toBeDefined()
    })
  })

  describe('Error Recovery Flow', () => {
    it('should auto-fix syntax errors when possible', async () => {
      const result = await handleBash({ input: 'echo "hello' })

      expect(result.valid).toBe(false)
      expect(result.fixed).toBeDefined()
      expect(result.fixed?.command).toBe('echo "hello"')
    })

    it('should provide suggestions when auto-fix is not possible', async () => {
      const result = await handleBash({ input: 'if true' })

      expect(result.valid).toBe(false)
      expect(result.suggestions).toBeDefined()
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('MCP Tool Edge Cases', () => {
  it('should handle very long commands', async () => {
    const longArg = 'a'.repeat(10000)
    const result = await handleBash({ input: `echo "${longArg}"` })

    expect(result.valid).toBe(true)
  })

  it('should handle special characters in input', async () => {
    const result = await handleBash({ input: "echo 'hello $world'" })

    expect(result.valid).toBe(true)
    expect(result.stdout).toContain('hello $world')
  })

  it('should handle unicode in input', async () => {
    const result = await handleBash({ input: 'echo "Hello, World!"' })

    expect(result.valid).toBe(true)
  })

  it('should handle newlines in input', async () => {
    const result = await handleBash({ input: 'echo "line1\nline2"' })

    expect(result.valid).toBe(true)
  })

  it('should handle command with environment variables', async () => {
    const result = await handleBash({ input: 'echo $HOME' })

    expect(result.valid).toBe(true)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('should handle heredocs', async () => {
    const result = await handleBash({
      input: `cat <<EOF
test content
EOF`,
    })

    expect(result.valid).toBe(true)
  })

  it('should handle subshells', async () => {
    const result = await handleBash({ input: '(cd /tmp && pwd)' })

    expect(result.valid).toBe(true)
    expect(result.stdout).toContain('/tmp')
  })

  it('should handle command substitution', async () => {
    const result = await handleBash({ input: 'echo $(date)' })

    expect(result.valid).toBe(true)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('should handle background jobs correctly', async () => {
    const result = await handleBash({ input: 'sleep 1 &' })

    expect(result.valid).toBe(true)
  })
})
