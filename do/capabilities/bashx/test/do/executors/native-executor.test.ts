/**
 * NativeExecutor Module Tests (RED)
 *
 * Tests for the NativeExecutor module that will be extracted from TieredExecutor.
 * NativeExecutor handles Tier 1 operations: in-Worker native commands via nodejs_compat_v2.
 *
 * This includes:
 * - Filesystem operations via FsCapability (cat, ls, head, tail, etc.)
 * - HTTP operations via fetch API (curl, wget)
 * - Data processing (jq, yq, base64, envsubst)
 * - Crypto operations via Web Crypto API (sha256sum, md5sum, etc.)
 * - Text processing (sed, awk, diff, patch, tee, xargs)
 * - POSIX utilities (cut, sort, tr, uniq, wc, echo, printf, etc.)
 * - System utilities (yes, whoami, hostname, printenv)
 * - Extended utilities (env, id, uname, tac)
 * - Pure computation (true, false, pwd, dirname, basename)
 *
 * Tests are written to FAIL until the module is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import types and classes that don't exist yet - this will cause compilation errors
import type {
  NativeExecutorConfig,
  NativeCapability,
  NativeCommandResult,
} from '../../../src/do/executors/native-executor.js'

import {
  NativeExecutor,
  createNativeExecutor,
  NATIVE_COMMANDS,
  FS_COMMANDS,
  HTTP_COMMANDS,
  DATA_COMMANDS,
  CRYPTO_COMMANDS,
  TEXT_PROCESSING_COMMANDS,
  POSIX_UTILS_COMMANDS,
  SYSTEM_UTILS_COMMANDS,
  EXTENDED_UTILS_COMMANDS,
} from '../../../src/do/executors/native-executor.js'

import type { FsCapability, BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// Mock FsCapability for testing
// ============================================================================

function createMockFs(): FsCapability {
  const files: Record<string, string> = {
    '/test/file.txt': 'Hello, World!\n',
    '/test/data.json': '{"name":"test","value":42}\n',
    '/test/multi.txt': 'line1\nline2\nline3\nline4\nline5\n',
  }

  return {
    read: async (path: string, options?: { encoding?: string }) => {
      if (files[path] === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return files[path]
    },
    write: async (path: string, data: string | Uint8Array) => {
      files[path] = typeof data === 'string' ? data : new TextDecoder().decode(data)
    },
    list: async (path: string, options?: { withFileTypes?: boolean }) => {
      const entries = Object.keys(files)
        .filter(f => f.startsWith(path + '/') || f === path)
        .map(f => {
          const name = f.replace(path + '/', '').split('/')[0]
          return {
            name,
            isDirectory: () => false,
            isFile: () => true,
          }
        })
      return entries
    },
    exists: async (path: string) => files[path] !== undefined,
    stat: async (path: string) => ({
      size: files[path]?.length ?? 0,
      isFile: () => files[path] !== undefined,
      isDirectory: () => false,
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date(),
      mode: 0o644,
      uid: 1000,
      gid: 1000,
    }),
    mkdir: async () => {},
    rmdir: async () => {},
    rm: async () => {},
    copy: async () => {},
    move: async () => {},
  } as unknown as FsCapability
}

// ============================================================================
// NativeExecutor Class Tests
// ============================================================================

describe('NativeExecutor', () => {
  describe('Construction', () => {
    it('should create an instance with no config', () => {
      const executor = new NativeExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(NativeExecutor)
    })

    it('should create an instance with FsCapability', () => {
      const fs = createMockFs()
      const executor = new NativeExecutor({ fs })

      expect(executor).toBeDefined()
      expect(executor.hasFsCapability).toBe(true)
    })

    it('should create an instance via factory function', () => {
      const executor = createNativeExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(NativeExecutor)
    })

    it('should create an instance with config via factory function', () => {
      const fs = createMockFs()
      const executor = createNativeExecutor({ fs })

      expect(executor).toBeDefined()
      expect(executor.hasFsCapability).toBe(true)
    })
  })

  describe('Command Classification', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor({ fs: createMockFs() })
    })

    it('should identify native commands', () => {
      expect(executor.canExecute('echo')).toBe(true)
      expect(executor.canExecute('cat')).toBe(true)
      expect(executor.canExecute('ls')).toBe(true)
      expect(executor.canExecute('jq')).toBe(true)
    })

    it('should reject non-native commands', () => {
      expect(executor.canExecute('docker')).toBe(false)
      expect(executor.canExecute('kubectl')).toBe(false)
      expect(executor.canExecute('python')).toBe(false)
    })

    it('should identify FS commands requiring FsCapability', () => {
      expect(executor.requiresFsCapability('cat')).toBe(true)
      expect(executor.requiresFsCapability('ls')).toBe(true)
      expect(executor.requiresFsCapability('head')).toBe(true)
      expect(executor.requiresFsCapability('tail')).toBe(true)
    })

    it('should identify commands that do not require FsCapability', () => {
      expect(executor.requiresFsCapability('echo')).toBe(false)
      expect(executor.requiresFsCapability('printf')).toBe(false)
      expect(executor.requiresFsCapability('date')).toBe(false)
    })

    it('should classify capability type for commands', () => {
      expect(executor.getCapability('cat')).toBe('fs')
      expect(executor.getCapability('curl')).toBe('http')
      expect(executor.getCapability('jq')).toBe('data')
      expect(executor.getCapability('sha256sum')).toBe('crypto')
      expect(executor.getCapability('sed')).toBe('text')
      expect(executor.getCapability('cut')).toBe('posix')
      expect(executor.getCapability('whoami')).toBe('system')
      expect(executor.getCapability('env')).toBe('extended')
      expect(executor.getCapability('echo')).toBe('compute')
    })
  })

  describe('Filesystem Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor({ fs: createMockFs() })
    })

    it('should execute cat command', async () => {
      const result = await executor.execute('cat /test/file.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello, World!\n')
      expect(result.stderr).toBe('')
    })

    it('should execute cat with multiple files', async () => {
      const result = await executor.execute('cat /test/file.txt /test/data.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello, World!')
      expect(result.stdout).toContain('"name":"test"')
    })

    it('should handle cat error for missing file', async () => {
      const result = await executor.execute('cat /nonexistent/file.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no such file')
    })

    it('should execute ls command', async () => {
      const result = await executor.execute('ls /test')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file.txt')
    })

    it('should execute head command', async () => {
      const result = await executor.execute('head -n 2 /test/multi.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line1\nline2\n')
    })

    it('should execute tail command', async () => {
      const result = await executor.execute('tail -n 2 /test/multi.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line4\nline5\n')
    })

    it('should execute test -e command', async () => {
      const result = await executor.execute('test -e /test/file.txt')

      expect(result.exitCode).toBe(0)
    })

    it('should execute test -f command', async () => {
      const result = await executor.execute('test -f /test/file.txt')

      expect(result.exitCode).toBe(0)
    })

    it('should fail test for non-existent file', async () => {
      const result = await executor.execute('test -e /nonexistent')

      expect(result.exitCode).toBe(1)
    })

    it('should fail fs commands without FsCapability', async () => {
      const noFsExecutor = new NativeExecutor()

      const result = await noFsExecutor.execute('cat /test/file.txt')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('FsCapability not available')
    })
  })

  describe('HTTP Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute curl command', async () => {
      const result = await executor.execute('curl https://httpbin.org/get')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBeDefined()
    })

    it('should execute curl with -s flag', async () => {
      const result = await executor.execute('curl -s https://httpbin.org/get')

      expect(result.exitCode).toBe(0)
    })

    it('should execute wget command', async () => {
      const result = await executor.execute('wget -qO- https://httpbin.org/get')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Data Processing Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute jq command', async () => {
      const result = await executor.execute('jq .name', {
        stdin: '{"name":"test"}',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('"test"')
    })

    it('should execute jq with filter', async () => {
      const result = await executor.execute('jq ".items | length"', {
        stdin: '{"items":[1,2,3]}',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })

    it('should execute base64 encode', async () => {
      const result = await executor.execute('base64', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('aGVsbG8=')
    })

    it('should execute base64 decode', async () => {
      const result = await executor.execute('base64 -d', {
        stdin: 'aGVsbG8=',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello')
    })

    it('should execute envsubst', async () => {
      const result = await executor.execute('envsubst', {
        stdin: 'Hello $NAME',
        env: { NAME: 'World' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
    })
  })

  describe('Crypto Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute sha256sum', async () => {
      const result = await executor.execute('sha256sum', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should execute md5sum', async () => {
      const result = await executor.execute('md5sum', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('5d41402abc4b2a76b9719d911017c592')
    })

    it('should execute uuidgen', async () => {
      const result = await executor.execute('uuidgen')

      expect(result.exitCode).toBe(0)
      // UUID v4 format
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('Text Processing Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute sed substitution', async () => {
      const result = await executor.execute('sed "s/hello/world/"', {
        stdin: 'hello there',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('world there\n')
    })

    it('should execute awk field extraction', async () => {
      const result = await executor.execute("awk '{print $1}'", {
        stdin: 'hello world',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('should execute diff command', async () => {
      const result = await executor.execute('diff', {
        stdin: 'a\nb\nc\n',
      })

      // diff with stdin only should work
      expect(result).toBeDefined()
    })
  })

  describe('POSIX Utility Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute echo', async () => {
      const result = await executor.execute('echo "hello world"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello world\n')
    })

    it('should execute echo with -n flag', async () => {
      const result = await executor.execute('echo -n "hello"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello')
    })

    it('should execute printf', async () => {
      const result = await executor.execute('printf "%s %d" hello 42')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello 42')
    })

    it('should execute cut', async () => {
      const result = await executor.execute('cut -d: -f1', {
        stdin: 'user:password:1000',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('user')
    })

    it('should execute sort', async () => {
      const result = await executor.execute('sort', {
        stdin: 'banana\napple\ncherry\n',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('apple\nbanana\ncherry\n')
    })

    it('should execute uniq', async () => {
      const result = await executor.execute('uniq', {
        stdin: 'a\na\nb\nb\nc\n',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('a\nb\nc\n')
    })

    it('should execute tr', async () => {
      const result = await executor.execute('tr a-z A-Z', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('HELLO')
    })

    it('should execute wc', async () => {
      const result = await executor.execute('wc -l', {
        stdin: 'line1\nline2\nline3\n',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })

    it('should execute basename', async () => {
      const result = await executor.execute('basename /path/to/file.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('file.txt')
    })

    it('should execute dirname', async () => {
      const result = await executor.execute('dirname /path/to/file.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('/path/to')
    })

    it('should execute date', async () => {
      const result = await executor.execute('date +%Y')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d{4}$/)
    })
  })

  describe('System Utility Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute whoami', async () => {
      const result = await executor.execute('whoami')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBeDefined()
    })

    it('should execute hostname', async () => {
      const result = await executor.execute('hostname')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBeDefined()
    })

    it('should execute printenv', async () => {
      const result = await executor.execute('printenv TEST_VAR', {
        env: { TEST_VAR: 'test_value' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('test_value')
    })

    it('should execute yes with limit', async () => {
      // yes should be limited to avoid infinite output
      const result = await executor.execute('yes | head -3')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('y\ny\ny\n')
    })
  })

  describe('Extended Utility Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute env', async () => {
      const result = await executor.execute('env', {
        env: { TEST: 'value' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('TEST=value')
    })

    it('should execute id', async () => {
      const result = await executor.execute('id')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('uid=')
    })

    it('should execute uname', async () => {
      const result = await executor.execute('uname -s')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBeDefined()
    })

    it('should execute tac', async () => {
      const result = await executor.execute('tac', {
        stdin: 'line1\nline2\nline3\n',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line3\nline2\nline1\n')
    })
  })

  describe('Pure Computation Commands', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute true', async () => {
      const result = await executor.execute('true')

      expect(result.exitCode).toBe(0)
    })

    it('should execute false', async () => {
      const result = await executor.execute('false')

      expect(result.exitCode).toBe(1)
    })

    it('should execute pwd', async () => {
      const result = await executor.execute('pwd', { cwd: '/tmp' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('/tmp')
    })

    it('should execute seq', async () => {
      const result = await executor.execute('seq 1 5')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('1\n2\n3\n4\n5\n')
    })

    it('should execute expr', async () => {
      const result = await executor.execute('expr 2 + 3')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })

    it('should execute bc', async () => {
      const result = await executor.execute('bc', {
        stdin: '2 + 3',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })

    it('should execute sleep', async () => {
      const start = Date.now()
      const result = await executor.execute('sleep 0.1')
      const elapsed = Date.now() - start

      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(100)
    })
  })

  describe('Pipeline Support', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should pass stdin to command', async () => {
      const result = await executor.execute('cat', {
        stdin: 'hello from stdin',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello from stdin')
    })

    it('should handle stdin for multiple commands', async () => {
      const result = await executor.execute('tr a-z A-Z', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('HELLO')
    })
  })

  describe('Timeout Handling', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should execute timeout command', async () => {
      const result = await executor.execute('timeout 1 echo hello')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('should respect timeout option', async () => {
      const result = await executor.execute('sleep 10', { timeout: 100 })

      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('Result Format', () => {
    let executor: NativeExecutor

    beforeEach(() => {
      executor = new NativeExecutor()
    })

    it('should return BashResult compatible structure', async () => {
      const result = await executor.execute('echo hello')

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

    it('should include tier information in classification', async () => {
      const result = await executor.execute('echo hello')

      expect(result.classification.reason).toContain('Tier 1')
    })
  })
})

// ============================================================================
// Command Sets Tests
// ============================================================================

describe('Native Command Sets', () => {
  it('should export NATIVE_COMMANDS set', () => {
    expect(NATIVE_COMMANDS).toBeDefined()
    expect(NATIVE_COMMANDS).toBeInstanceOf(Set)
    expect(NATIVE_COMMANDS.has('echo')).toBe(true)
    expect(NATIVE_COMMANDS.has('cat')).toBe(true)
  })

  it('should export FS_COMMANDS set', () => {
    expect(FS_COMMANDS).toBeDefined()
    expect(FS_COMMANDS.has('cat')).toBe(true)
    expect(FS_COMMANDS.has('ls')).toBe(true)
    expect(FS_COMMANDS.has('head')).toBe(true)
    expect(FS_COMMANDS.has('tail')).toBe(true)
  })

  it('should export HTTP_COMMANDS set', () => {
    expect(HTTP_COMMANDS).toBeDefined()
    expect(HTTP_COMMANDS.has('curl')).toBe(true)
    expect(HTTP_COMMANDS.has('wget')).toBe(true)
  })

  it('should export DATA_COMMANDS set', () => {
    expect(DATA_COMMANDS).toBeDefined()
    expect(DATA_COMMANDS.has('jq')).toBe(true)
    expect(DATA_COMMANDS.has('yq')).toBe(true)
    expect(DATA_COMMANDS.has('base64')).toBe(true)
  })

  it('should export CRYPTO_COMMANDS set', () => {
    expect(CRYPTO_COMMANDS).toBeDefined()
    expect(CRYPTO_COMMANDS.has('sha256sum')).toBe(true)
    expect(CRYPTO_COMMANDS.has('md5sum')).toBe(true)
    expect(CRYPTO_COMMANDS.has('uuidgen')).toBe(true)
  })

  it('should export TEXT_PROCESSING_COMMANDS set', () => {
    expect(TEXT_PROCESSING_COMMANDS).toBeDefined()
    expect(TEXT_PROCESSING_COMMANDS.has('sed')).toBe(true)
    expect(TEXT_PROCESSING_COMMANDS.has('awk')).toBe(true)
  })

  it('should export POSIX_UTILS_COMMANDS set', () => {
    expect(POSIX_UTILS_COMMANDS).toBeDefined()
    expect(POSIX_UTILS_COMMANDS.has('cut')).toBe(true)
    expect(POSIX_UTILS_COMMANDS.has('sort')).toBe(true)
  })

  it('should export SYSTEM_UTILS_COMMANDS set', () => {
    expect(SYSTEM_UTILS_COMMANDS).toBeDefined()
    expect(SYSTEM_UTILS_COMMANDS.has('whoami')).toBe(true)
    expect(SYSTEM_UTILS_COMMANDS.has('hostname')).toBe(true)
  })

  it('should export EXTENDED_UTILS_COMMANDS set', () => {
    expect(EXTENDED_UTILS_COMMANDS).toBeDefined()
    expect(EXTENDED_UTILS_COMMANDS.has('env')).toBe(true)
    expect(EXTENDED_UTILS_COMMANDS.has('id')).toBe(true)
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('NativeExecutor Type Definitions', () => {
  it('should have correct NativeExecutorConfig shape', () => {
    const config: NativeExecutorConfig = {
      fs: createMockFs(),
      defaultTimeout: 30000,
    }

    expect(config).toBeDefined()
  })

  it('should have correct NativeCapability type', () => {
    const capability: NativeCapability = 'fs'
    const validCapabilities: NativeCapability[] = [
      'fs',
      'http',
      'data',
      'crypto',
      'text',
      'posix',
      'system',
      'extended',
      'compute',
    ]

    expect(validCapabilities).toContain(capability)
  })
})
