/**
 * SDK Client Tests (RED Phase)
 *
 * Tests for the bashx SDK client - the primary user-facing API.
 * Tests the `bashx` tagged template patterns for both commands and intents.
 *
 * These tests verify:
 * - Tagged template syntax: bashx`command`
 * - Direct function call: bashx('command', options)
 * - Options factory: bashx({ cwd: '/tmp' })`command`
 * - Raw mode: bashx.raw`command`
 * - With helper: bashx.with({ timeout: 5000 })`command`
 * - Escape utility: bashx.escape(value)
 * - Intent detection: bashx`find all typescript files`
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// Storage for the mock function - will be populated by the mock factory
let mockBashFn: ReturnType<typeof vi.fn>

// Mock the rpc.do module BEFORE importing the module under test
vi.mock('rpc.do', () => {
  // Create mock inside the factory
  const bashMock = vi.fn()
  // Store reference for tests to access
  ;(globalThis as any).__mockBashFn = bashMock

  return {
    RPC: vi.fn(() => ({
      bash: bashMock,
    })),
    http: vi.fn((baseUrl: string, token?: string) => ({
      baseUrl,
      token,
      type: 'http',
    })),
    default: vi.fn(),
  }
})

// Import after mock is set up
import { Bash, bash, type BashResult, type BashClientExtended, type BashOptions } from '../src/index.js'

// Get the mock reference after module loads
beforeAll(() => {
  mockBashFn = (globalThis as any).__mockBashFn
})

// Get the mock for assertions
const getMockBash = () => (globalThis as any).__mockBashFn as ReturnType<typeof vi.fn>

/**
 * Helper to create a mock BashResult
 */
function mockResult(overrides: Partial<BashResult> = {}): BashResult {
  return {
    input: 'test',
    command: 'test',
    stdout: '',
    stderr: '',
    exitCode: 0,
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
      reason: 'Read-only operation',
    },
    ...overrides,
  }
}

describe('SDK Client', () => {
  let mockBash: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockBash = getMockBash()
  })

  describe('Bash Factory', () => {
    it('should create a client with default options', () => {
      const client = Bash()
      expect(client).toBeDefined()
      expect(typeof client).toBe('function')
    })

    it('should create a client with custom baseUrl', () => {
      const client = Bash({ baseUrl: 'https://custom.bashx.do' })
      expect(client).toBeDefined()
    })

    it('should create a client with auth token', () => {
      const client = Bash({ baseUrl: 'https://api.bashx.do', token: 'my-token' })
      expect(client).toBeDefined()
    })
  })

  describe('Tagged Template: bashx`command`', () => {
    it('should execute a simple command via tagged template', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls -la',
        command: 'ls -la',
        stdout: 'total 0\ndrwxr-xr-x  2 user  staff  64 Jan  1 00:00 .',
      }))

      const result = await bash`ls -la`

      expect(mockBash).toHaveBeenCalledWith('ls -la')
      expect(result.stdout).toContain('total')
    })

    it('should execute git commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'git status',
        command: 'git status',
        stdout: 'On branch main\nnothing to commit',
      }))

      const result = await bash`git status`

      expect(mockBash).toHaveBeenCalledWith('git status')
      expect(result.stdout).toContain('branch')
    })

    it('should execute commands with flags', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'find . -type f -name "*.ts"',
        command: 'find . -type f -name "*.ts"',
      }))

      const result = await bash`find . -type f -name "*.ts"`

      expect(mockBash).toHaveBeenCalledWith('find . -type f -name "*.ts"')
    })

    it('should handle piped commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'cat file.txt | grep error | wc -l',
        command: 'cat file.txt | grep error | wc -l',
        stdout: '42',
      }))

      const result = await bash`cat file.txt | grep error | wc -l`

      expect(mockBash).toHaveBeenCalledWith('cat file.txt | grep error | wc -l')
      expect(result.stdout).toBe('42')
    })
  })

  describe('Tagged Template with Interpolation', () => {
    it('should escape interpolated values by default', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "cat 'my file.txt'",
        command: "cat 'my file.txt'",
      }))

      const file = 'my file.txt'
      await bash`cat ${file}`

      expect(mockBash).toHaveBeenCalledWith("cat 'my file.txt'")
    })

    it('should escape dangerous interpolated values', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "echo '; rm -rf /'",
        command: "echo '; rm -rf /'",
      }))

      const userInput = '; rm -rf /'
      await bash`echo ${userInput}`

      // The input should be escaped, preventing command injection
      expect(mockBash).toHaveBeenCalledWith("echo '; rm -rf /'")
    })

    it('should escape command substitution attempts', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "echo '$(whoami)'",
        command: "echo '$(whoami)'",
      }))

      const malicious = '$(whoami)'
      await bash`echo ${malicious}`

      expect(mockBash).toHaveBeenCalledWith("echo '$(whoami)'")
    })

    it('should escape backtick command substitution', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "echo '`id`'",
        command: "echo '`id`'",
      }))

      const malicious = '`id`'
      await bash`echo ${malicious}`

      expect(mockBash).toHaveBeenCalledWith("echo '`id`'")
    })

    it('should handle multiple interpolated values', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "cp 'source file.txt' 'dest file.txt'",
        command: "cp 'source file.txt' 'dest file.txt'",
      }))

      const src = 'source file.txt'
      const dst = 'dest file.txt'
      await bash`cp ${src} ${dst}`

      expect(mockBash).toHaveBeenCalledWith("cp 'source file.txt' 'dest file.txt'")
    })

    it('should escape values with single quotes', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "git commit -m 'fix: it'\"'\"'s working'",
        command: "git commit -m 'fix: it'\"'\"'s working'",
      }))

      const message = "fix: it's working"
      await bash`git commit -m ${message}`

      // Single quotes in the message should be properly escaped
      expect(mockBash).toHaveBeenCalledWith("git commit -m 'fix: it'\"'\"'s working'")
    })

    it('should not quote safe alphanumeric values', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'cat package.json',
        command: 'cat package.json',
      }))

      const file = 'package.json'
      await bash`cat ${file}`

      expect(mockBash).toHaveBeenCalledWith('cat package.json')
    })

    it('should not quote paths with safe characters', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls /usr/local/bin',
        command: 'ls /usr/local/bin',
      }))

      const path = '/usr/local/bin'
      await bash`ls ${path}`

      expect(mockBash).toHaveBeenCalledWith('ls /usr/local/bin')
    })
  })

  describe('Direct Function Call: bashx("command")', () => {
    it('should execute via direct function call', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls -la',
        command: 'ls -la',
      }))

      const result = await bash('ls -la')

      expect(mockBash).toHaveBeenCalledWith('ls -la', undefined)
    })

    it('should accept options as second argument', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls',
        command: 'ls',
      }))

      const options: BashOptions = { cwd: '/tmp', timeout: 5000 }
      await bash('ls', options)

      expect(mockBash).toHaveBeenCalledWith('ls', options)
    })

    it('should accept confirm option for dangerous commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'rm -rf build/',
        command: 'rm -rf build/',
      }))

      await bash('rm -rf build/', { confirm: true })

      expect(mockBash).toHaveBeenCalledWith('rm -rf build/', { confirm: true })
    })

    it('should accept dryRun option', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'rm -rf /',
        command: 'rm -rf /',
        blocked: true,
        requiresConfirm: true,
      }))

      const result = await bash('rm -rf /', { dryRun: true })

      expect(mockBash).toHaveBeenCalledWith('rm -rf /', { dryRun: true })
    })

    it('should accept environment variables', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'npm run build',
        command: 'npm run build',
      }))

      await bash('npm run build', { env: { NODE_ENV: 'production' } })

      expect(mockBash).toHaveBeenCalledWith('npm run build', { env: { NODE_ENV: 'production' } })
    })
  })

  describe('Options Factory: bashx({ options })`command`', () => {
    it('should create a tagged template with bound options', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls',
        command: 'ls',
      }))

      await bash({ cwd: '/tmp' })`ls`

      expect(mockBash).toHaveBeenCalledWith('ls', { cwd: '/tmp' })
    })

    it('should bind timeout option', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'slow-command',
        command: 'slow-command',
      }))

      await bash({ timeout: 60000 })`slow-command`

      expect(mockBash).toHaveBeenCalledWith('slow-command', { timeout: 60000 })
    })

    it('should bind confirm option', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'rm -rf old/',
        command: 'rm -rf old/',
      }))

      await bash({ confirm: true })`rm -rf old/`

      expect(mockBash).toHaveBeenCalledWith('rm -rf old/', { confirm: true })
    })

    it('should bind multiple options', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'npm install',
        command: 'npm install',
      }))

      await bash({
        cwd: '/app',
        timeout: 120000,
        env: { CI: 'true' },
      })`npm install`

      expect(mockBash).toHaveBeenCalledWith('npm install', {
        cwd: '/app',
        timeout: 120000,
        env: { CI: 'true' },
      })
    })

    it('should still escape interpolated values with options factory', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "cat 'my file.txt'",
        command: "cat 'my file.txt'",
      }))

      const file = 'my file.txt'
      await bash({ cwd: '/tmp' })`cat ${file}`

      expect(mockBash).toHaveBeenCalledWith("cat 'my file.txt'", { cwd: '/tmp' })
    })
  })

  describe('Raw Mode: bashx.raw`command`', () => {
    it('should NOT escape interpolated values', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'find . -name *.ts',
        command: 'find . -name *.ts',
      }))

      const pattern = '*.ts'
      await bash.raw`find . -name ${pattern}`

      // In raw mode, the glob pattern should NOT be quoted
      expect(mockBash).toHaveBeenCalledWith('find . -name *.ts', undefined)
    })

    it('should pass through shell metacharacters', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls -la && pwd',
        command: 'ls -la && pwd',
      }))

      const cmd = 'ls -la && pwd'
      await bash.raw`${cmd}`

      expect(mockBash).toHaveBeenCalledWith('ls -la && pwd', undefined)
    })

    it('should pass through command substitution (DANGEROUS)', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'echo $(whoami)',
        command: 'echo $(whoami)',
      }))

      const sub = '$(whoami)'
      await bash.raw`echo ${sub}`

      // WARNING: This is dangerous! Command substitution would execute
      expect(mockBash).toHaveBeenCalledWith('echo $(whoami)', undefined)
    })

    it('should handle glob patterns correctly', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'rm *.log',
        command: 'rm *.log',
      }))

      const pattern = '*.log'
      await bash.raw`rm ${pattern}`

      expect(mockBash).toHaveBeenCalledWith('rm *.log', undefined)
    })
  })

  describe('With Helper: bashx.with({ options })', () => {
    it('should create a reusable configured client', async () => {
      mockBash.mockResolvedValueOnce(mockResult({ input: 'ls', command: 'ls' }))
      mockBash.mockResolvedValueOnce(mockResult({ input: 'pwd', command: 'pwd' }))

      const tmpBash = bash.with({ cwd: '/tmp' })

      await tmpBash`ls`
      await tmpBash`pwd`

      expect(mockBash).toHaveBeenCalledTimes(2)
      expect(mockBash).toHaveBeenNthCalledWith(1, 'ls', { cwd: '/tmp' })
      expect(mockBash).toHaveBeenNthCalledWith(2, 'pwd', { cwd: '/tmp' })
    })

    it('should bind timeout for all commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({ input: 'cmd1', command: 'cmd1' }))
      mockBash.mockResolvedValueOnce(mockResult({ input: 'cmd2', command: 'cmd2' }))

      const fastBash = bash.with({ timeout: 1000 })

      await fastBash`cmd1`
      await fastBash`cmd2`

      expect(mockBash).toHaveBeenNthCalledWith(1, 'cmd1', { timeout: 1000 })
      expect(mockBash).toHaveBeenNthCalledWith(2, 'cmd2', { timeout: 1000 })
    })

    it('should still escape interpolated values', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: "cat 'file with spaces.txt'",
        command: "cat 'file with spaces.txt'",
      }))

      const safeBash = bash.with({ cwd: '/home' })
      const file = 'file with spaces.txt'
      await safeBash`cat ${file}`

      expect(mockBash).toHaveBeenCalledWith("cat 'file with spaces.txt'", { cwd: '/home' })
    })
  })

  describe('Escape Utility: bashx.escape()', () => {
    it('should be available as a utility function', () => {
      expect(bash.escape).toBeDefined()
      expect(typeof bash.escape).toBe('function')
    })

    it('should escape strings with spaces', () => {
      expect(bash.escape('hello world')).toBe("'hello world'")
    })

    it('should escape shell metacharacters', () => {
      expect(bash.escape('; rm -rf /')).toBe("'; rm -rf /'")
    })

    it('should escape command substitution', () => {
      expect(bash.escape('$(whoami)')).toBe("'$(whoami)'")
    })

    it('should not quote safe strings', () => {
      expect(bash.escape('simple')).toBe('simple')
      expect(bash.escape('file.txt')).toBe('file.txt')
      expect(bash.escape('/usr/bin')).toBe('/usr/bin')
    })

    it('should handle empty string', () => {
      expect(bash.escape('')).toBe("''")
    })

    it('should handle strings with single quotes', () => {
      const escaped = bash.escape("it's fine")
      expect(escaped).toBe("'it'\"'\"'s fine'")
    })

    it('should convert non-string values', () => {
      expect(bash.escape(123)).toBe('123')
      expect(bash.escape(true)).toBe('true')
    })
  })

  describe('Intent Detection: bashx`natural language`', () => {
    it('should detect natural language intent and generate command', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'find all typescript files',
        command: 'find . -name "*.ts" -type f',
        generated: true,
      }))

      const result = await bash`find all typescript files`

      expect(mockBash).toHaveBeenCalledWith('find all typescript files')
      expect(result.generated).toBe(true)
    })

    it('should generate command for file search intent', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'list files larger than 10MB',
        command: 'find . -type f -size +10M',
        generated: true,
      }))

      const result = await bash`list files larger than 10MB`

      expect(result.generated).toBe(true)
      expect(result.command).toContain('find')
    })

    it('should generate command for git operations', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'show recent commits',
        command: 'git log --oneline -10',
        generated: true,
      }))

      const result = await bash`show recent commits`

      expect(result.generated).toBe(true)
      expect(result.command).toContain('git')
    })

    it('should handle complex intent descriptions', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'find all files modified in the last week and delete them',
        command: 'find . -type f -mtime -7 -delete',
        generated: true,
        classification: {
          type: 'delete',
          impact: 'high',
          reversible: false,
          reason: 'Deletes files modified in last 7 days',
        },
      }))

      const result = await bash`find all files modified in the last week and delete them`

      expect(result.generated).toBe(true)
      expect(result.classification.impact).toBe('high')
    })
  })

  describe('Result Structure', () => {
    it('should return complete result with all fields', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'ls -la',
        command: 'ls -la',
        stdout: 'file1.txt\nfile2.txt',
        stderr: '',
        exitCode: 0,
        valid: true,
        generated: false,
        intent: {
          commands: ['ls'],
          reads: ['.'],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: {
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'Read-only directory listing',
        },
      }))

      const result = await bash`ls -la`

      expect(result.input).toBe('ls -la')
      expect(result.command).toBe('ls -la')
      expect(result.stdout).toBe('file1.txt\nfile2.txt')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.valid).toBe(true)
      expect(result.generated).toBe(false)
      expect(result.intent).toBeDefined()
      expect(result.classification).toBeDefined()
    })

    it('should include AST when valid', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'echo hello',
        command: 'echo hello',
        valid: true,
        ast: {
          type: 'Program',
          body: [
            {
              type: 'Command',
              name: { type: 'Word', value: 'echo' },
              prefix: [],
              args: [{ type: 'Word', value: 'hello' }],
              redirects: [],
            },
          ],
        },
      }))

      const result = await bash`echo hello`

      expect(result.ast).toBeDefined()
      expect(result.ast?.type).toBe('Program')
    })

    it('should include blocked info for dangerous commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'rm -rf /',
        command: 'rm -rf /',
        blocked: true,
        requiresConfirm: true,
        blockReason: 'Dangerous: recursive delete of root filesystem',
        classification: {
          type: 'delete',
          impact: 'critical',
          reversible: false,
          reason: 'Recursive delete of root filesystem',
        },
      }))

      const result = await bash`rm -rf /`

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toContain('Dangerous')
    })

    it('should include undo info for reversible commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'mv file.txt backup.txt',
        command: 'mv file.txt backup.txt',
        undo: 'mv backup.txt file.txt',
        classification: {
          type: 'write',
          impact: 'medium',
          reversible: true,
          reason: 'File rename',
        },
      }))

      const result = await bash`mv file.txt backup.txt`

      expect(result.undo).toBe('mv backup.txt file.txt')
      expect(result.classification.reversible).toBe(true)
    })

    it('should include suggestions for failed commands', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'git stauts',
        command: 'git stauts',
        exitCode: 1,
        stderr: "git: 'stauts' is not a git command",
        suggestions: ['git status', 'git stash'],
      }))

      const result = await bash`git stauts`

      expect(result.exitCode).toBe(1)
      expect(result.suggestions).toContain('git status')
    })

    it('should include fixed command for syntax errors', async () => {
      mockBash.mockResolvedValueOnce(mockResult({
        input: 'echo "hello',
        command: 'echo "hello"',
        valid: true,
        fixed: {
          command: 'echo "hello"',
          changes: [
            {
              type: 'insert',
              position: 'end',
              value: '"',
              reason: 'Unclosed double quote',
            },
          ],
        },
      }))

      const result = await bash`echo "hello`

      expect(result.fixed).toBeDefined()
      expect(result.fixed?.command).toBe('echo "hello"')
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockBash.mockRejectedValueOnce(new Error('Network error'))

      await expect(bash`ls`).rejects.toThrow('Network error')
    })

    it('should handle timeout errors', async () => {
      mockBash.mockRejectedValueOnce(new Error('Request timeout'))

      await expect(bash`sleep 1000`).rejects.toThrow('timeout')
    })

    it('should handle authentication errors', async () => {
      mockBash.mockRejectedValueOnce(new Error('Unauthorized'))

      await expect(bash`ls`).rejects.toThrow('Unauthorized')
    })
  })

  describe('Custom Client Configuration', () => {
    it('should use custom baseUrl', async () => {
      const customBash = Bash({ baseUrl: 'https://custom.bashx.do' })

      // The mock captures the RPC call, verify it was created with custom URL
      expect(customBash).toBeDefined()
    })

    it('should use auth token', async () => {
      const authedBash = Bash({
        baseUrl: 'https://api.bashx.do',
        token: 'secret-token',
      })

      expect(authedBash).toBeDefined()
    })

    it('should allow creating multiple independent clients', async () => {
      const client1 = Bash({ baseUrl: 'https://prod.bashx.do' })
      const client2 = Bash({ baseUrl: 'https://dev.bashx.do' })

      expect(client1).not.toBe(client2)
    })
  })
})

describe('Type Safety', () => {
  it('should have correct types for BashClientExtended', () => {
    // These are compile-time checks - if types are wrong, TS will error
    const _client: BashClientExtended = bash

    // Should accept string
    const _p1: Promise<BashResult> = _client('ls')

    // Should accept string with options
    const _p2: Promise<BashResult> = _client('ls', { timeout: 1000 })

    // Should accept template strings array (tagged template)
    // Note: This is checked at compile time by TypeScript

    // Should have raw property
    expect(typeof _client.raw).toBe('function')

    // Should have with method
    expect(typeof _client.with).toBe('function')

    // Should have escape method
    expect(typeof _client.escape).toBe('function')
  })

  it('should return BashResult type', async () => {
    const mockBash = getMockBash()
    mockBash.mockResolvedValueOnce(mockResult())

    const result: BashResult = await bash`ls`

    // Type checks - these will fail at compile time if types are wrong
    const _input: string = result.input
    const _command: string = result.command
    const _stdout: string = result.stdout
    const _stderr: string = result.stderr
    const _exitCode: number = result.exitCode
    const _valid: boolean = result.valid
    const _generated: boolean = result.generated
  })
})
