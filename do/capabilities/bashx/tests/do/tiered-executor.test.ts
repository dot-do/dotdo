/**
 * Tests for TieredExecutor
 *
 * Verifies the 4-tier execution model:
 * - Tier 1: Native in-Worker via nodejs_compat_v2
 * - Tier 2: RPC bindings for jq.do/npm.do
 * - Tier 3: worker_loaders for dynamic npm
 * - Tier 4: Sandbox SDK for true Linux needs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TieredExecutor,
  createTieredExecutor,
  type TieredExecutorConfig,
  type SandboxBinding,
  type RpcServiceBinding,
  type WorkerLoaderBinding,
} from '../../src/do/tiered-executor.js'
import type { FsCapability, FsEntry, FsStat, BashResult } from '../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock FsCapability that matches fsx.do's interface.
 *
 * fsx.do's FsCapability has:
 * - read(path, options?) - returns string when encoding is 'utf-8', Uint8Array otherwise
 * - list(path, options?) - returns Dirent[] (with methods) when withFileTypes: true
 * - stat(path) - returns Stats with isFile()/isDirectory() as methods
 */
function createMockFsCapability(): FsCapability {
  const files: Record<string, string> = {
    '/test.txt': 'hello world\n',
    '/multi.txt': 'line1\nline2\nline3\nline4\nline5\n',
    '/data.json': '{"name": "test"}\n',
  }

  // fsx.do returns Dirent-like objects with isDirectory() as a method
  const directories: Record<string, Array<{ name: string; isDirectory(): boolean }>> = {
    '/': [
      { name: 'test.txt', isDirectory: () => false },
      { name: 'multi.txt', isDirectory: () => false },
      { name: 'data.json', isDirectory: () => false },
      { name: 'subdir', isDirectory: () => true },
    ],
    '/subdir': [{ name: 'nested.txt', isDirectory: () => false }],
  }

  return {
    // fsx.do read() accepts options parameter with encoding
    read: async (path: string, options?: { encoding?: string }) => {
      if (files[path]) return files[path]
      throw new Error(`ENOENT: no such file: ${path}`)
    },
    exists: async (path) => path in files || path in directories,
    // fsx.do list() accepts options and returns Dirent[] with methods when withFileTypes: true
    list: async (path: string, options?: { withFileTypes?: boolean }) => {
      return directories[path] || []
    },
    // fsx.do stat() returns Stats with isFile()/isDirectory() as methods
    stat: async (path: string) => {
      if (files[path]) {
        return {
          size: files[path].length,
          // fsx.do Stats class has isFile() and isDirectory() as methods
          isDirectory: () => false,
          isFile: () => true,
          // Additional Stats properties for compatibility
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
        }
      }
      if (directories[path]) {
        return {
          size: 0,
          // fsx.do Stats class has isFile() and isDirectory() as methods
          isDirectory: () => true,
          isFile: () => false,
          mode: 0o755,
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
        }
      }
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    },
  } as unknown as FsCapability
}

function createMockSandbox(): SandboxBinding {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => ({
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
    })),
  }
}

function createMockRpcBinding(): RpcServiceBinding {
  return {
    name: 'jq',
    endpoint: 'https://jq.do',
    commands: ['jq'],
  }
}

// ============================================================================
// TIER CLASSIFICATION TESTS
// ============================================================================

describe('TieredExecutor - Command Classification', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('Tier 1 Classification', () => {
    it('classifies pure compute commands as Tier 1', () => {
      // true/false are pure compute commands
      const pureComputeCommands = ['true', 'false']
      for (const cmd of pureComputeCommands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(1)
        expect(classification.handler).toBe('native')
        expect(classification.capability).toBe('compute')
      }

      // echo, printf, date are now classified as POSIX utils
      const posixCommands = ['echo hello', 'printf test', 'date']
      for (const cmd of posixCommands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(1)
        expect(classification.handler).toBe('native')
        expect(classification.capability).toBe('posix')
      }
    })

    it('classifies filesystem commands as Tier 1 when fs is available', () => {
      const commands = ['cat /test.txt', 'ls /', 'head -n 5 /file', 'tail /log']

      for (const cmd of commands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(1)
        expect(classification.handler).toBe('native')
        expect(classification.capability).toBe('fs')
      }
    })

    it('classifies filesystem commands as Tier 4 when fs is NOT available', () => {
      const noFsExecutor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const classification = noFsExecutor.classifyCommand('cat /test.txt')
      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
    })
  })

  describe('Tier 2 Classification', () => {
    it('classifies jq commands as Tier 1 (native implementation)', () => {
      // jq is now Tier 1 with native implementation via TIER_1_DATA_COMMANDS
      const classification = executor.classifyCommand('jq .name package.json')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('jq')
    })

    it('classifies npm commands as Tier 2', () => {
      const commands = ['npm install', 'npx vitest', 'pnpm add lodash', 'yarn add react']

      for (const cmd of commands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(2)
        expect(classification.handler).toBe('rpc')
        expect(classification.capability).toBe('npm')
      }
    })

    it('classifies git commands as Tier 2', () => {
      const classification = executor.classifyCommand('git status')
      expect(classification.tier).toBe(2)
      expect(classification.handler).toBe('rpc')
      expect(classification.capability).toBe('git')
    })
  })

  describe('Tier 1 HTTP Classification', () => {
    it('classifies curl commands as Tier 1 (http)', () => {
      const classification = executor.classifyCommand('curl https://example.com.ai')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('http')
    })

    it('classifies wget commands as Tier 1 (http)', () => {
      const classification = executor.classifyCommand('wget https://example.com.ai/file.txt')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.capability).toBe('http')
    })
  })

  describe('Tier 4 Classification', () => {
    it('classifies docker commands as Tier 4', () => {
      const commands = ['docker ps', 'docker run alpine', 'docker-compose up']

      for (const cmd of commands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(4)
        expect(classification.handler).toBe('sandbox')
      }
    })

    it('classifies network commands (except curl/wget) as Tier 4', () => {
      const commands = ['ssh server', 'ping google.com', 'scp file server:/path']

      for (const cmd of commands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(4)
        expect(classification.handler).toBe('sandbox')
      }
    })

    it('classifies system commands as Tier 4', () => {
      // Note: chmod is now Tier 1 (filesystem) - removed from this list
      const commands = ['sudo apt install vim', 'ps aux', 'kill 1234']

      for (const cmd of commands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.tier).toBe(4)
        expect(classification.handler).toBe('sandbox')
      }
    })
  })
})

// ============================================================================
// TIER 1 EXECUTION TESTS
// ============================================================================

describe('TieredExecutor - Tier 1 Execution', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('Pure Compute Commands', () => {
    it('executes echo command natively', async () => {
      const result = await executor.execute('echo hello world')
      expect(result.stdout).toBe('hello world\n')
      expect(result.exitCode).toBe(0)
    })

    it('executes true command with exit code 0', async () => {
      const result = await executor.execute('true')
      expect(result.exitCode).toBe(0)
    })

    it('executes false command with exit code 1', async () => {
      const result = await executor.execute('false')
      expect(result.exitCode).toBe(1)
    })

    it('executes date command', async () => {
      const result = await executor.execute('date')
      expect(result.stdout).toBeTruthy()
      expect(result.exitCode).toBe(0)
    })

    it('executes pwd command', async () => {
      const result = await executor.execute('pwd', { cwd: '/home/user' })
      expect(result.stdout).toBe('/home/user\n')
      expect(result.exitCode).toBe(0)
    })

    it('executes basename command', async () => {
      const result = await executor.execute('basename /path/to/file.txt')
      expect(result.stdout).toBe('file.txt\n')
    })

    it('executes dirname command', async () => {
      const result = await executor.execute('dirname /path/to/file.txt')
      expect(result.stdout).toBe('/path/to\n')
    })

    it('executes wc -l with stdin', async () => {
      const result = await executor.execute('wc -l', { stdin: 'line1\nline2\nline3\n' })
      expect(result.stdout).toBe('3\n')
    })

    it('executes sort with stdin', async () => {
      const result = await executor.execute('sort', { stdin: 'c\na\nb\n' })
      expect(result.stdout).toBe('a\nb\nc\n')
    })

    it('executes sort -r with stdin', async () => {
      const result = await executor.execute('sort -r', { stdin: 'a\nb\nc\n' })
      expect(result.stdout).toBe('c\nb\na\n')
    })
  })

  describe('Filesystem Commands', () => {
    it('executes cat command via FsCapability', async () => {
      const result = await executor.execute('cat /test.txt')
      expect(result.stdout).toBe('hello world\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles cat with missing file', async () => {
      const result = await executor.execute('cat /nonexistent.txt')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ENOENT')
    })

    it('executes ls command via FsCapability', async () => {
      const result = await executor.execute('ls /')
      expect(result.stdout).toContain('test.txt')
      expect(result.stdout).toContain('subdir/')
      expect(result.exitCode).toBe(0)
    })

    it('executes head command via FsCapability', async () => {
      const result = await executor.execute('head -n2 /multi.txt')
      expect(result.stdout).toBe('line1\nline2\n')
    })

    it('executes tail command via FsCapability', async () => {
      const result = await executor.execute('tail -n2 /multi.txt')
      expect(result.stdout).toBe('line4\nline5\n')
    })

    it('executes test -e for existing file', async () => {
      const result = await executor.execute('test -e /test.txt')
      expect(result.exitCode).toBe(0)
    })

    it('executes test -e for non-existing file', async () => {
      const result = await executor.execute('test -e /nonexistent.txt')
      expect(result.exitCode).toBe(1)
    })

    it('executes test -f for regular file', async () => {
      const result = await executor.execute('test -f /test.txt')
      expect(result.exitCode).toBe(0)
    })

    it('executes test -d for directory', async () => {
      const result = await executor.execute('test -d /')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('HTTP Commands (curl/wget via fetch)', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('executes curl GET request via fetch API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{"data": "test"}',
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl https://api.example.com.ai/data')

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com.ai/data', {
        method: 'GET',
        headers: undefined,
        body: undefined,
        redirect: 'manual',
      })
      expect(result.stdout).toBe('{"data": "test"}')
      expect(result.exitCode).toBe(0)
    })

    it('executes curl POST with -d data', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{"success": true}',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl -d {"name":"test"} https://api.example.com.ai/create')

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com.ai/create', {
        method: 'POST',
        headers: undefined,
        body: '{"name":"test"}',
        redirect: 'manual',
      })
      expect(result.stdout).toBe('{"success": true}')
      expect(result.exitCode).toBe(0)
    })

    it('executes curl with custom headers -H', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'OK',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl -H "Authorization: Bearer token123" https://api.example.com.ai/secure')

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com.ai/secure', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token123' },
        body: undefined,
        redirect: 'manual',
      })
      expect(result.exitCode).toBe(0)
    })

    it('executes curl with -L to follow redirects', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'Redirected content',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl -L https://example.com.ai/redirect')

      expect(mockFetch).toHaveBeenCalledWith('https://example.com.ai/redirect', {
        method: 'GET',
        headers: undefined,
        body: undefined,
        redirect: 'follow',
      })
      expect(result.exitCode).toBe(0)
    })

    it('executes curl with -X method override', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl -X DELETE https://api.example.com.ai/resource/123')

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com.ai/resource/123', {
        method: 'DELETE',
        headers: undefined,
        body: undefined,
        redirect: 'manual',
      })
      expect(result.exitCode).toBe(0)
    })

    it('executes curl HEAD request with -I', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
        headers: new Headers({
          'content-type': 'text/html',
          'content-length': '12345',
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl -I https://example.com.ai')

      expect(mockFetch).toHaveBeenCalledWith('https://example.com.ai', {
        method: 'HEAD',
        headers: undefined,
        body: undefined,
        redirect: 'manual',
      })
      expect(result.stdout).toContain('HTTP/1.1 200 OK')
      expect(result.exitCode).toBe(0)
    })

    it('curl returns error for missing URL', async () => {
      const result = await executor.execute('curl')

      expect(result.stderr).toContain('no URL specified')
      expect(result.exitCode).toBe(1)
    })

    it('curl returns exit code 1 for non-OK response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl https://example.com.ai/notfound')

      expect(result.exitCode).toBe(1)
    })

    it('executes wget basic download via fetch API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'File content here',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('wget -O - https://example.com.ai/file.txt')

      expect(mockFetch).toHaveBeenCalledWith('https://example.com.ai/file.txt', {
        method: 'GET',
        headers: undefined,
        redirect: 'follow',
      })
      expect(result.stdout).toBe('File content here')
      expect(result.exitCode).toBe(0)
    })

    it('wget with custom headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'Authorized content',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('wget -O - --header "Authorization: token" https://example.com.ai/secure')

      expect(mockFetch).toHaveBeenCalledWith('https://example.com.ai/secure', {
        method: 'GET',
        headers: { 'Authorization': 'token' },
        redirect: 'follow',
      })
      expect(result.exitCode).toBe(0)
    })

    it('wget returns error for missing URL', async () => {
      const result = await executor.execute('wget')

      expect(result.stderr).toContain('missing URL')
      expect(result.exitCode).toBe(1)
    })

    it('curl handles fetch errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('curl https://unreachable.example.com.ai')

      expect(result.stderr).toContain('curl:')
      expect(result.stderr).toContain('Network error')
      expect(result.exitCode).toBe(1)
    })

    it('wget handles fetch errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await executor.execute('wget -O - https://unreachable.example.com.ai')

      expect(result.stderr).toContain('wget:')
      expect(result.stderr).toContain('Connection refused')
      expect(result.exitCode).toBe(1)
    })

    it('curl adds https:// protocol when missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'content',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      await executor.execute('curl example.com.ai/api')

      expect(mockFetch).toHaveBeenCalledWith('https://example.com.ai/api', expect.any(Object))
    })

    it('curl with basic auth -u', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'authenticated',
        headers: new Headers(),
      })
      vi.stubGlobal('fetch', mockFetch)

      await executor.execute('curl -u user:pass https://api.example.com.ai/secure')

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com.ai/secure', {
        method: 'GET',
        headers: { 'Authorization': 'Basic dXNlcjpwYXNz' }, // base64 of "user:pass"
        body: undefined,
        redirect: 'manual',
      })
    })
  })
})

// ============================================================================
// TIER 2 EXECUTION TESTS (RPC)
// ============================================================================

describe('TieredExecutor - Tier 2 Execution (RPC)', () => {
  // Note: jq now has a native Tier 1 implementation, so we use a custom RPC service for testing
  it('calls RPC endpoint for custom RPC command', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: '{"filtered": true}\n',
        stderr: '',
        exitCode: 0,
      }),
    })

    vi.stubGlobal('fetch', mockFetch)

    // Use a custom tool that doesn't have a native implementation
    const executor = new TieredExecutor({
      rpcBindings: {
        customtool: {
          name: 'customtool',
          endpoint: 'https://customtool.do',
          commands: ['customtool'],
        },
      },
    })

    const result = await executor.execute('customtool --process data.json')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://customtool.do/execute',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(result.stdout).toBe('{"filtered": true}\n')
    expect(result.exitCode).toBe(0)

    vi.unstubAllGlobals()
  })

  it('handles RPC error gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Service unavailable',
    })

    vi.stubGlobal('fetch', mockFetch)

    // Use a custom tool that doesn't have a native implementation
    const executor = new TieredExecutor({
      rpcBindings: {
        customtool: {
          name: 'customtool',
          endpoint: 'https://customtool.do',
          commands: ['customtool'],
        },
      },
    })

    const result = await executor.execute('customtool --process data.json')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('RPC error')

    vi.unstubAllGlobals()
  })
})

// ============================================================================
// TIER 4 EXECUTION TESTS (SANDBOX)
// ============================================================================

describe('TieredExecutor - Tier 4 Execution (Sandbox)', () => {
  it('executes docker command via sandbox', async () => {
    const mockSandbox = createMockSandbox()
    const executor = new TieredExecutor({
      sandbox: mockSandbox,
    })

    const result = await executor.execute('docker ps')

    expect(mockSandbox.execute).toHaveBeenCalledWith('docker ps', expect.objectContaining({ timeout: 30000 }))
    expect(result.stdout).toContain('sandbox: docker ps')
  })

  it('executes ssh command via sandbox', async () => {
    const mockSandbox = createMockSandbox()
    const executor = new TieredExecutor({
      sandbox: mockSandbox,
    })

    const result = await executor.execute('ssh user@server')

    expect(mockSandbox.execute).toHaveBeenCalled()
    expect(result.exitCode).toBe(0)
  })

  it('throws error when sandbox not available', async () => {
    const executor = new TieredExecutor({})

    await expect(executor.execute('docker ps')).rejects.toThrow(
      'Sandbox not configured'
    )
  })

  it('passes options to sandbox execute', async () => {
    const mockSandbox = createMockSandbox()
    const executor = new TieredExecutor({
      sandbox: mockSandbox,
    })

    const options = { cwd: '/app', timeout: 5000 }
    await executor.execute('bash script.sh', options)

    expect(mockSandbox.execute).toHaveBeenCalledWith('bash script.sh', expect.objectContaining({ cwd: '/app', timeout: 5000 }))
  })
})

// ============================================================================
// FALLBACK TESTS
// ============================================================================

describe('TieredExecutor - Tier Fallback', () => {
  it('falls back to sandbox when Tier 2 RPC fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', mockFetch)

    const mockSandbox = createMockSandbox()
    // Use a custom RPC service that doesn't have a native Tier 1 implementation
    const executor = new TieredExecutor({
      rpcBindings: {
        customtool: {
          name: 'customtool',
          endpoint: 'https://customtool.do',
          commands: ['customtool'],
        },
      },
      sandbox: mockSandbox,
    })

    const result = await executor.execute('customtool --process data.json')

    // Should have tried RPC first, then fallen back to sandbox
    expect(mockFetch).toHaveBeenCalled()
    expect(mockSandbox.execute).toHaveBeenCalled()
    expect(result.stdout).toContain('sandbox:')

    vi.unstubAllGlobals()
  })
})

// ============================================================================
// CAPABILITIES TESTS
// ============================================================================

describe('TieredExecutor - Capabilities', () => {
  it('reports available capabilities', () => {
    const executor = new TieredExecutor({
      fs: createMockFsCapability(),
      rpcBindings: {
        jq: createMockRpcBinding(),
      },
      sandbox: createMockSandbox(),
    })

    const caps = executor.getCapabilities()

    expect(caps.tier1.available).toBe(true)
    expect(caps.tier1.commands).toContain('echo')
    expect(caps.tier1.commands).toContain('cat')

    expect(caps.tier2.available).toBe(true)
    expect(caps.tier2.services).toContain('jq')

    expect(caps.tier4.available).toBe(true)
  })

  it('checks tier availability for specific commands', () => {
    const executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })

    expect(executor.isTierAvailable(1, 'echo hello')).toBe(true)
    expect(executor.isTierAvailable(1, 'cat file.txt')).toBe(true)
    expect(executor.isTierAvailable(1, 'docker ps')).toBe(false)

    expect(executor.isTierAvailable(4, 'docker ps')).toBe(true)
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createTieredExecutor', () => {
  it('creates executor from environment', () => {
    const env = {}
    const executor = createTieredExecutor(env, {
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })

    expect(executor).toBeInstanceOf(TieredExecutor)
    expect(executor.isTierAvailable(1)).toBe(true)
    expect(executor.isTierAvailable(4)).toBe(true)
  })

  it('creates executor without options', () => {
    const executor = createTieredExecutor({})

    expect(executor).toBeInstanceOf(TieredExecutor)
    // Pure compute is always available
    expect(executor.isTierAvailable(1, 'echo test')).toBe(true)
    // Sandbox not available
    expect(executor.isTierAvailable(4)).toBe(false)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('TieredExecutor - Edge Cases', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  it('handles empty command', async () => {
    const classification = executor.classifyCommand('')
    expect(classification.tier).toBe(4)
  })

  it('handles command with env vars prefix', async () => {
    const classification = executor.classifyCommand('VAR=value echo hello')
    expect(classification.tier).toBe(1)
    // echo is now classified as a POSIX utility command
    expect(classification.capability).toBe('posix')
  })

  it('handles absolute path commands', async () => {
    const classification = executor.classifyCommand('/usr/bin/ls')
    expect(classification.tier).toBe(1)
    expect(classification.capability).toBe('fs')
  })

  it('handles quoted arguments correctly', async () => {
    const result = await executor.execute("echo 'hello world'")
    expect(result.stdout).toBe('hello world\n')
  })

  it('handles double-quoted arguments', async () => {
    const result = await executor.execute('echo "hello world"')
    expect(result.stdout).toBe('hello world\n')
  })

  it('preserves command result structure', async () => {
    const result = await executor.execute('echo test')

    expect(result).toHaveProperty('input')
    expect(result).toHaveProperty('command')
    expect(result).toHaveProperty('stdout')
    expect(result).toHaveProperty('stderr')
    expect(result).toHaveProperty('exitCode')
    expect(result).toHaveProperty('valid')
    expect(result).toHaveProperty('generated')
    expect(result).toHaveProperty('intent')
    expect(result).toHaveProperty('classification')
  })
})

// ============================================================================
// LANGUAGE ROUTING TESTS (RED PHASE - TDD)
// ============================================================================

/**
 * Tests for TieredExecutor language-aware routing.
 *
 * These tests verify the integration of language detection and routing
 * to PolyglotExecutor for non-bash languages. The TieredExecutor will:
 *
 * 1. Detect language from input using detectLanguage()
 * 2. If non-bash, route to PolyglotExecutor (Tier 1.5)
 * 3. If bash, use existing tier logic
 *
 * This is "Tier 1.5" - warm language runtimes that are faster than
 * cold-start sandbox but not as fast as native in-Worker execution.
 *
 * These tests are RED phase - they will FAIL until the implementation
 * is added to TieredExecutor.
 */
describe('TieredExecutor - Language Routing', () => {
  // Mock language bindings for polyglot executor
  function createMockLanguageBinding(language: string, output: string): { fetch: typeof fetch } {
    return {
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        return new Response(JSON.stringify({
          stdout: output,
          stderr: '',
          exitCode: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    }
  }

  // --------------------------------------------------------------------------
  // Language Detection Integration
  // --------------------------------------------------------------------------

  describe('Language Detection Integration', () => {
    it('detects Python from python command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('python -c "print(1+1)"')

      expect(detection.language).toBe('python')
      expect(detection.confidence).toBeGreaterThan(0.8)
    })

    it('detects Python from python3 command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('python3 script.py')

      expect(detection.language).toBe('python')
      expect(detection.method).toBe('interpreter')
    })

    it('detects Ruby from ruby command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('ruby -e "puts 1+1"')

      expect(detection.language).toBe('ruby')
      expect(detection.confidence).toBeGreaterThan(0.8)
    })

    it('detects Node from node command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('node -e "console.log(1+1)"')

      expect(detection.language).toBe('node')
      expect(detection.confidence).toBeGreaterThan(0.8)
    })

    it('detects Go from go run command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('go run main.go')

      expect(detection.language).toBe('go')
    })

    it('detects Rust from cargo command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('cargo run')

      expect(detection.language).toBe('rust')
    })

    it('detects bash from shell commands', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('ls -la')

      expect(detection.language).toBe('bash')
    })

    it('detects bash from echo command', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const detection = executor.detectLanguage('echo "hello world"')

      expect(detection.language).toBe('bash')
    })

    it('detects language from shebang in multi-line input', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const pythonScript = `#!/usr/bin/env python3
print("Hello, World!")
`
      const detection = executor.detectLanguage(pythonScript)

      expect(detection.language).toBe('python')
      expect(detection.method).toBe('shebang')
      expect(detection.confidence).toBeGreaterThan(0.9)
    })
  })

  // --------------------------------------------------------------------------
  // Routing to PolyglotExecutor
  // --------------------------------------------------------------------------

  describe('Routing to PolyglotExecutor', () => {
    it('routes Python commands to PolyglotExecutor', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'Hello from Python\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('python -c "print(\'Hello from Python\')"')

      expect(result.stdout).toBe('Hello from Python\n')
      expect(result.exitCode).toBe(0)
      expect(pythonBinding.fetch).toHaveBeenCalled()
    })

    it('routes Ruby commands to PolyglotExecutor', async () => {
      const rubyBinding = createMockLanguageBinding('ruby', 'Hello from Ruby\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          ruby: rubyBinding,
        },
      })

      const result = await executor.execute('ruby -e "puts \'Hello from Ruby\'"')

      expect(result.stdout).toBe('Hello from Ruby\n')
      expect(result.exitCode).toBe(0)
      expect(rubyBinding.fetch).toHaveBeenCalled()
    })

    it('routes Node commands to PolyglotExecutor', async () => {
      const nodeBinding = createMockLanguageBinding('node', 'Hello from Node\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          node: nodeBinding,
        },
      })

      const result = await executor.execute('node -e "console.log(\'Hello from Node\')"')

      expect(result.stdout).toBe('Hello from Node\n')
      expect(result.exitCode).toBe(0)
      expect(nodeBinding.fetch).toHaveBeenCalled()
    })

    it('routes Go commands to PolyglotExecutor', async () => {
      const goBinding = createMockLanguageBinding('go', 'Hello from Go\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          go: goBinding,
        },
      })

      const result = await executor.execute('go run main.go')

      expect(result.stdout).toBe('Hello from Go\n')
      expect(result.exitCode).toBe(0)
      expect(goBinding.fetch).toHaveBeenCalled()
    })

    it('routes Rust/Cargo commands to PolyglotExecutor', async () => {
      const rustBinding = createMockLanguageBinding('rust', 'Hello from Rust\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          rust: rustBinding,
        },
      })

      const result = await executor.execute('cargo run')

      expect(result.stdout).toBe('Hello from Rust\n')
      expect(result.exitCode).toBe(0)
      expect(rustBinding.fetch).toHaveBeenCalled()
    })

    it('routes pip commands to Python PolyglotExecutor', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'Successfully installed requests\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('pip install requests')

      expect(result.stdout).toContain('Successfully installed')
      expect(pythonBinding.fetch).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Result Format
  // --------------------------------------------------------------------------

  describe('Result Format', () => {
    it('includes language in BashResult', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'output\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('python -c "print(1)"')

      // The result should have language information in classification or metadata
      expect(result.classification.language).toBe('python')
    })

    it('includes tier 1.5 in BashResult for polyglot execution', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'output\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('python -c "print(1)"')

      // The classification should indicate polyglot tier (1.5)
      expect(result.classification.handler).toBe('polyglot')
    })

    it('includes polyglot reason in classification', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'output\n')
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('python -c "print(1)"')

      expect(result.classification.reason).toContain('polyglot')
    })
  })

  // --------------------------------------------------------------------------
  // Fallback Behavior
  // --------------------------------------------------------------------------

  describe('Fallback Behavior', () => {
    it('falls back to sandbox when language worker unavailable', async () => {
      const mockSandbox = createMockSandbox()
      const executor = new TieredExecutor({
        sandbox: mockSandbox,
        // No languageWorkers configured for python
      })

      const result = await executor.execute('python -c "print(1)"')

      // Should fallback to sandbox
      expect(mockSandbox.execute).toHaveBeenCalled()
    })

    it('falls back to sandbox when PolyglotExecutor RPC fails', async () => {
      const failingBinding: { fetch: typeof fetch } = {
        fetch: vi.fn(async () => {
          throw new Error('Service unavailable')
        }),
      }
      const mockSandbox = createMockSandbox()
      const executor = new TieredExecutor({
        sandbox: mockSandbox,
        languageWorkers: {
          python: failingBinding,
        },
      })

      const result = await executor.execute('python -c "print(1)"')

      // Should fallback to sandbox after polyglot failure
      expect(mockSandbox.execute).toHaveBeenCalled()
    })

    it('uses existing tier selection for bash commands', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'Python output\n')
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('echo "hello bash"')

      // Should NOT call pythonBinding for bash commands
      expect(pythonBinding.fetch).not.toHaveBeenCalled()
      // Should execute via Tier 1 native
      expect(result.stdout).toBe('hello bash\n')
    })

    it('uses existing tier selection for cat command', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'Python output\n')
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const result = await executor.execute('cat /test.txt')

      // Should NOT call pythonBinding for bash commands
      expect(pythonBinding.fetch).not.toHaveBeenCalled()
      // Should execute via Tier 1 filesystem
      expect(result.stdout).toBe('hello world\n')
    })
  })

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  describe('Configuration', () => {
    it('accepts languageWorkers in config', () => {
      const pythonBinding = createMockLanguageBinding('python', 'output')
      const rubyBinding = createMockLanguageBinding('ruby', 'output')

      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
          ruby: rubyBinding,
        },
      })

      expect(executor).toBeDefined()
      expect(executor.hasLanguageWorker('python')).toBe(true)
      expect(executor.hasLanguageWorker('ruby')).toBe(true)
      expect(executor.hasLanguageWorker('go')).toBe(false)
    })

    it('works without languageWorkers configured', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      expect(executor).toBeDefined()
      expect(executor.hasLanguageWorker('python')).toBe(false)
    })

    it('getAvailableLanguages returns configured languages', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: createMockLanguageBinding('python', ''),
          ruby: createMockLanguageBinding('ruby', ''),
          node: createMockLanguageBinding('node', ''),
        },
      })

      const languages = executor.getAvailableLanguages()

      expect(languages).toContain('python')
      expect(languages).toContain('ruby')
      expect(languages).toContain('node')
      expect(languages).not.toContain('go')
      expect(languages).not.toContain('rust')
    })

    it('getAvailableLanguages returns empty array when no workers configured', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const languages = executor.getAvailableLanguages()

      expect(languages).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // Classification with Language
  // --------------------------------------------------------------------------

  describe('Classification with Language', () => {
    it('classifies python command as polyglot tier when worker available', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: createMockLanguageBinding('python', ''),
        },
      })

      const classification = executor.classifyCommand('python script.py')

      expect(classification.handler).toBe('polyglot')
      expect(classification.capability).toBe('python')
    })

    it('classifies python command as sandbox when no worker available', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        // No languageWorkers
      })

      const classification = executor.classifyCommand('python script.py')

      // Should fall through to sandbox (Tier 4)
      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
    })

    it('classifies ruby command as polyglot tier when worker available', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          ruby: createMockLanguageBinding('ruby', ''),
        },
      })

      const classification = executor.classifyCommand('ruby script.rb')

      expect(classification.handler).toBe('polyglot')
      expect(classification.capability).toBe('ruby')
    })

    it('classifies node command as polyglot tier when worker available', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          node: createMockLanguageBinding('node', ''),
        },
      })

      const classification = executor.classifyCommand('node app.js')

      expect(classification.handler).toBe('polyglot')
      expect(classification.capability).toBe('node')
    })
  })
})

// ============================================================================
// CACHING AND METRICS TESTS
// ============================================================================

describe('TieredExecutor - Caching and Metrics', () => {
  describe('Classification Caching', () => {
    it('caches classification results for the same command name', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // First call should be a cache miss
      const classification1 = executor.classifyCommand('echo hello')
      const metrics1 = executor.getMetrics()
      expect(metrics1.cacheMisses).toBe(1)
      expect(metrics1.cacheHits).toBe(0)

      // Second call with same command name should be a cache hit
      const classification2 = executor.classifyCommand('echo world')
      const metrics2 = executor.getMetrics()
      expect(metrics2.cacheHits).toBe(1)
      expect(metrics2.cacheMisses).toBe(1)

      // Classifications should be the same (same command type)
      expect(classification1.tier).toBe(classification2.tier)
      expect(classification1.handler).toBe(classification2.handler)
      expect(classification1.capability).toBe(classification2.capability)
    })

    it('caches by command name only for most commands', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // Different arguments but same command should hit cache
      executor.classifyCommand('ls -la')
      executor.classifyCommand('ls -R')
      executor.classifyCommand('ls /tmp')

      const metrics = executor.getMetrics()
      expect(metrics.cacheMisses).toBe(1)
      expect(metrics.cacheHits).toBe(2)
    })

    it('uses full command as cache key for npm commands', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // npm view should be native
      executor.classifyCommand('npm view lodash')
      // npm install should be RPC (different classification)
      executor.classifyCommand('npm install lodash')

      const metrics = executor.getMetrics()
      // Both should be cache misses since npm uses full command as key
      expect(metrics.cacheMisses).toBe(2)
    })

    it('clearCaches resets the classification cache', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // Populate cache
      executor.classifyCommand('echo hello')
      executor.classifyCommand('echo hello')
      expect(executor.getMetrics().cacheHits).toBe(1)

      // Clear and verify
      executor.clearCaches()
      const stats = executor.getCacheStats()
      expect(stats.classificationCacheSize).toBe(0)

      // Should be a cache miss now
      executor.classifyCommand('echo hello')
      expect(executor.getMetrics().cacheMisses).toBe(2)
    })
  })

  describe('Metrics Collection', () => {
    it('tracks metrics only when enabled', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      // Metrics disabled by default
      executor.classifyCommand('echo hello')
      const metrics1 = executor.getMetrics()
      expect(metrics1.totalClassifications).toBe(0)

      // Enable metrics
      executor.enableMetrics()
      executor.classifyCommand('echo world')
      const metrics2 = executor.getMetrics()
      expect(metrics2.totalClassifications).toBe(1)
    })

    it('tracks tier counts correctly', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // Tier 1 commands
      executor.classifyCommand('echo hello')
      executor.classifyCommand('cat /test.txt')
      executor.classifyCommand('date')

      // Tier 2 RPC command
      executor.classifyCommand('git status')

      // Tier 4 sandbox command
      executor.classifyCommand('docker ps')

      const metrics = executor.getMetrics()
      expect(metrics.tierCounts[1]).toBe(3)
      expect(metrics.tierCounts[2]).toBe(1)
      expect(metrics.tierCounts[4]).toBe(1)
    })

    it('tracks handler counts correctly', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      executor.classifyCommand('echo hello')
      executor.classifyCommand('cat /test.txt')
      executor.classifyCommand('git status')
      executor.classifyCommand('docker ps')

      const metrics = executor.getMetrics()
      expect(metrics.handlerCounts['native']).toBe(2)
      expect(metrics.handlerCounts['rpc']).toBe(1)
      expect(metrics.handlerCounts['sandbox']).toBe(1)
    })

    it('calculates cache hit ratio correctly', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // 4 classifications: 2 unique commands, 2 cache hits
      executor.classifyCommand('echo hello')
      executor.classifyCommand('echo world')  // cache hit
      executor.classifyCommand('date')
      executor.classifyCommand('date +%Y')    // cache hit

      const metrics = executor.getMetrics()
      expect(metrics.cacheHits).toBe(2)
      expect(metrics.cacheMisses).toBe(2)
      expect(metrics.cacheHitRatio).toBe(0.5)
    })

    it('resetMetrics clears all counters', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      executor.classifyCommand('echo hello')
      executor.classifyCommand('echo world')
      executor.classifyCommand('git status')

      executor.resetMetrics()
      const metrics = executor.getMetrics()

      expect(metrics.totalClassifications).toBe(0)
      expect(metrics.cacheHits).toBe(0)
      expect(metrics.cacheMisses).toBe(0)
      expect(metrics.tierCounts[1]).toBe(0)
      expect(metrics.tierCounts[2]).toBe(0)
      expect(metrics.tierCounts[3]).toBe(0)
      expect(metrics.tierCounts[4]).toBe(0)
      expect(Object.keys(metrics.handlerCounts).length).toBe(0)
    })

    it('disableMetrics stops tracking', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      executor.enableMetrics()
      executor.classifyCommand('echo hello')
      expect(executor.getMetrics().totalClassifications).toBe(1)

      executor.disableMetrics()
      executor.classifyCommand('date')
      expect(executor.getMetrics().totalClassifications).toBe(1) // Still 1
    })
  })

  describe('Language Detection Caching', () => {
    it('caches language detection results', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      // Call detectLanguage twice with same input
      const result1 = executor.detectLanguage('python -c "print(1)"')
      const result2 = executor.detectLanguage('python -c "print(1)"')

      // Both should return the same result
      expect(result1.language).toBe(result2.language)
      expect(result1.confidence).toBe(result2.confidence)

      // Cache should have one entry
      const stats = executor.getCacheStats()
      expect(stats.languageDetectionCacheSize).toBe(1)
    })

    it('getCacheStats returns cache sizes', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      // Populate caches
      executor.classifyCommand('echo hello')
      executor.classifyCommand('date')
      executor.detectLanguage('python script.py')

      const stats = executor.getCacheStats()
      expect(stats.classificationCacheSize).toBe(2)
      expect(stats.languageDetectionCacheSize).toBe(1)
    })
  })

  describe('Cache Performance', () => {
    it('handles many classifications without memory issues', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })
      executor.enableMetrics()

      // Generate many unique commands
      const commands = ['echo', 'date', 'pwd', 'cat', 'ls', 'head', 'tail', 'wc', 'sort', 'uniq']
      for (let i = 0; i < 100; i++) {
        const cmd = commands[i % commands.length]
        executor.classifyCommand(`${cmd} arg${i}`)
      }

      const metrics = executor.getMetrics()
      // Most should be cache hits since commands repeat
      expect(metrics.cacheHits).toBeGreaterThan(80)
      expect(metrics.totalClassifications).toBe(100)
    })
  })
})
