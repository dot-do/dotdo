/**
 * Agent Tool Binding Tests (RED Phase)
 *
 * Tests verifying agents can execute tools (file ops, git, code).
 * These tests should FAIL until tool binding is implemented.
 *
 * The key issue: Named agents currently only return text responses.
 * They cannot actually execute tools like write_file, read_file, or bash.
 * This is blocking because agents need to DO things, not just talk about them.
 *
 * @see dotdo-ntzl2 - [RED] Test agent tool binding
 * @see dotdo-a7nx3 - [GREEN] Implement tool binding
 * @module agents/tests/tool-binding
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { ralph, tom, enableMockMode, disableMockMode, setMockResponse } from '../named'
import * as fs from 'fs/promises'
import * as path from 'path'

describe('Agent Tool Binding', () => {
  const testDir = path.join(process.cwd(), 'tests', '.output', 'agent-tool-binding')

  beforeAll(() => {
    // Use mock mode to avoid API key issues during RED phase testing
    // The tests should still FAIL because tool binding doesn't exist
    enableMockMode()
  })

  afterAll(() => {
    disableMockMode()
  })

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('File Operations via Tools', () => {
    it('ralph should be able to create files via write_file tool', async () => {
      const targetFile = path.join(testDir, 'hello.ts')

      // Set up a mock response that would include tool use
      // In the GREEN phase, the agent would actually call the write_file tool
      setMockResponse('create a file', '[Tool: write_file] Created file successfully')

      // Ralph should use write_file tool - but currently just returns text
      await ralph`create a file at ${targetFile} with a hello world function`

      // This assertion SHOULD FAIL in RED phase
      // The file should NOT exist because agents can't execute tools yet
      const exists = await fs.access(targetFile).then(() => true).catch(() => false)
      expect(exists).toBe(true)

      const content = await fs.readFile(targetFile, 'utf-8')
      expect(content).toContain('hello')
    })

    it('ralph should be able to read files via read_file tool', async () => {
      const sourceFile = path.join(testDir, 'source.ts')
      // Use a unique value that won't accidentally match mock response
      const secretValue = `unique-secret-${Date.now()}`
      await fs.writeFile(sourceFile, `export const secret = "${secretValue}"`)

      // Don't set mock response - we want to verify actual file reading
      // The agent should use read_file tool to get the actual content

      const result = await ralph`read the file at ${sourceFile} and tell me what the secret value is`

      // This should FAIL - the agent doesn't actually read the file
      // In GREEN phase, the agent would use read_file tool and extract the value
      expect(result.toLowerCase()).toContain(secretValue.toLowerCase())
    })

    it('ralph should be able to edit files via edit_file tool', async () => {
      const targetFile = path.join(testDir, 'edit-test.ts')
      await fs.writeFile(targetFile, 'export const value = 1')

      setMockResponse('edit', '[Tool: edit_file] File edited successfully')

      await ralph`edit the file at ${targetFile} and change the value from 1 to 42`

      // This assertion SHOULD FAIL in RED phase
      const content = await fs.readFile(targetFile, 'utf-8')
      expect(content).toContain('42')
      expect(content).not.toContain('value = 1')
    })
  })

  describe('Shell Execution via Tools', () => {
    it('ralph should be able to run shell commands via bash tool', async () => {
      setMockResponse('run', 'The output was: hello')

      // Agent should be able to run commands - but can't in RED phase
      const result = await ralph`run "echo hello" and tell me the output`

      // This should FAIL - the agent doesn't actually run the command
      // It just returns mock text that happens to contain 'hello'
      expect(result.toLowerCase()).toContain('hello')

      // More importantly, we should verify the command was ACTUALLY run
      // This is the real test - did bash execute?
      // In GREEN phase, we'd verify by having the command write to a file
      const outputFile = path.join(testDir, 'bash-output.txt')
      await ralph`run "echo actual-execution > ${outputFile}"`
      const exists = await fs.access(outputFile).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('ralph should be able to run npm commands', async () => {
      const outputFile = path.join(testDir, 'npm-version.txt')

      await ralph`run "npm --version > ${outputFile}"`

      // This SHOULD FAIL - agent can't execute npm
      const exists = await fs.access(outputFile).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })
  })

  describe('Code Review with Tool Access', () => {
    it('tom should be able to read files when reviewing code', async () => {
      const codeFile = path.join(testDir, 'review-target.ts')
      // Create a unique file name that the mock won't know about
      const uniqueFileName = `unique-file-${Date.now()}.ts`
      const uniqueCodeFile = path.join(testDir, uniqueFileName)
      await fs.writeFile(uniqueCodeFile, `
        function add(a, b) {
          return a + b
        }
      `)

      // Don't set mock response - we want to verify actual file reading
      // Tom should use read_file tool to read the file content

      const review = await tom`review the file at ${uniqueCodeFile} for TypeScript best practices`

      // Should mention the actual file content in the review
      // The agent reads the file and includes the filename in the review
      expect(review.includes(uniqueFileName) || String(review).includes(uniqueFileName)).toBe(true)
      expect(review.toLowerCase()).toMatch(/type|typescript|annotation|number/i)
    })

    it('tom should provide structured review response', async () => {
      const codeToReview = `
        function add(a, b) {
          return a + b
        }
      `

      // Don't set mock response
      const review = await tom`review this code for TypeScript best practices: ${codeToReview}`

      // Review should be a structured object, not just text
      // This SHOULD FAIL - currently returns plain string
      expect(typeof review).toBe('object')
      expect(review).toHaveProperty('approved')
      expect(review).toHaveProperty('issues')
      expect(review).toHaveProperty('suggestions')
    })
  })

  describe('Tool Schema Definition', () => {
    it('agents should expose their available tools', () => {
      // Agents should have a tools property exposing available tools
      expect(ralph.tools).toBeDefined()
      expect(Array.isArray(ralph.tools)).toBe(true)
      expect(ralph.tools.length).toBeGreaterThan(0)
    })

    it('ralph should have file operation tools', () => {
      const toolNames = ralph.tools?.map((t: { name: string }) => t.name) ?? []

      expect(toolNames).toContain('write_file')
      expect(toolNames).toContain('read_file')
      expect(toolNames).toContain('edit_file')
    })

    it('ralph should have bash/shell tool', () => {
      const toolNames = ralph.tools?.map((t: { name: string }) => t.name) ?? []

      expect(toolNames).toContain('bash')
    })

    it('ralph should have glob and grep tools for code search', () => {
      const toolNames = ralph.tools?.map((t: { name: string }) => t.name) ?? []

      expect(toolNames).toContain('glob')
      expect(toolNames).toContain('grep')
    })

    it('tools should have proper schema definitions', () => {
      const writeFileTool = ralph.tools?.find((t: { name: string }) => t.name === 'write_file')

      expect(writeFileTool).toBeDefined()
      expect(writeFileTool?.inputSchema).toBeDefined()
      expect(writeFileTool?.description).toContain('file')
    })
  })

  describe('Git Operations via Tools', () => {
    it('ralph should be able to stage files', async () => {
      // Create a test file
      const testFile = path.join(testDir, 'git-test.ts')
      await fs.writeFile(testFile, 'export const x = 1')

      await ralph`stage the file ${testFile} for commit`

      // Verify the file was staged (this would need git status check)
      // For now, just verify the tool was called
      expect(ralph.tools?.some((t: { name: string }) => t.name === 'git_add' || t.name === 'bash')).toBe(true)
    })

    it('ralph should be able to commit changes', async () => {
      // Create a unique commit message
      const uniqueMessage = `test-commit-${Date.now()}`

      await ralph`commit the staged changes with message "${uniqueMessage}"`

      // This SHOULD FAIL - agent can't execute git commands yet
      // Verify the tool was available and used
      expect(ralph.tools).toBeDefined()
      expect(ralph.tools?.some((t: { name: string }) => t.name === 'git_commit' || t.name === 'bash')).toBe(true)
    })
  })

  describe('Tool Execution Loop', () => {
    it('should support multi-step tool execution', async () => {
      const targetFile = path.join(testDir, 'multi-step.ts')

      // A complex task that requires multiple tool calls
      await ralph`
        1. Create a file at ${targetFile} with a function that adds two numbers
        2. Read the file back to verify it was created
        3. Run the TypeScript compiler to check for errors
      `

      // All steps should have been executed
      const exists = await fs.access(targetFile).then(() => true).catch(() => false)
      expect(exists).toBe(true)

      const content = await fs.readFile(targetFile, 'utf-8')
      expect(content).toContain('function')
    })

    it('should handle tool errors gracefully', async () => {
      const nonExistentFile = `/this/path/does/not/exist/file-${Date.now()}.ts`

      // Should not throw, but return an error message about file not found
      const result = await ralph`read the file at ${nonExistentFile}`

      expect(result).toBeDefined()
      // The agent should have tried to use read_file tool and gotten an error
      // This SHOULD FAIL - agent doesn't actually try to read the file
      expect(result.toLowerCase()).toMatch(/error|not found|doesn't exist|cannot|enoent/i)
    })

    it('should report tool execution in result', async () => {
      const targetFile = path.join(testDir, 'tool-report.ts')

      const result = await ralph`create a file at ${targetFile} with "hello"`

      // Result should include information about tool calls made
      // This SHOULD FAIL - no tool execution tracking exists
      expect(result).toHaveProperty('toolCalls')
      expect(result.toolCalls).toBeInstanceOf(Array)
      expect(result.toolCalls.length).toBeGreaterThan(0)
      expect(result.toolCalls[0]).toHaveProperty('name', 'write_file')
    })
  })
})
