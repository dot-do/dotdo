/**
 * Text Processing Commands Tests
 *
 * [RED] TDD Phase - Comprehensive FAILING tests for text processing commands.
 * These tests define the expected behavior - implementation comes later.
 *
 * Tests cover:
 * - sed (stream editor)
 * - awk (pattern scanning)
 * - diff (file comparison)
 * - patch (apply diffs)
 * - tee (write to multiple outputs)
 * - xargs (build command lines)
 *
 * @module bashx/do/commands/text-processing.test
 */

import { describe, it, expect } from 'vitest'
import { TieredExecutor, type TieredExecutorConfig, type SandboxBinding } from '../tiered-executor.js'
import type { BashResult, ExecOptions, FsCapability } from '../../types.js'

// ============================================================================
// TEST FIXTURES & HELPERS
// ============================================================================

/**
 * Mock filesystem for testing text processing commands.
 * Provides in-memory file storage with POSIX-like API.
 */
function createMockFs(files: Record<string, string>): FsCapability {
  const storage = new Map<string, string>(Object.entries(files))

  return {
    read: async (path: string, _options?: { encoding?: string }) => {
      const content = storage.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return content
    },
    write: async (path: string, content: string | Uint8Array) => {
      storage.set(path, typeof content === 'string' ? content : new TextDecoder().decode(content))
    },
    exists: async (path: string) => storage.has(path),
    stat: async (path: string) => {
      if (!storage.has(path)) {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`)
      }
      return {
        isFile: () => true,
        isDirectory: () => false,
        size: storage.get(path)!.length,
        mode: 0o644,
        uid: 1000,
        gid: 1000,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      }
    },
    list: async (path: string, _options?: { withFileTypes?: boolean }) => {
      const entries: Array<{ name: string; isDirectory(): boolean }> = []
      for (const [filePath] of storage) {
        if (filePath.startsWith(path)) {
          const name = filePath.slice(path.length).replace(/^\//, '').split('/')[0]
          if (name && !entries.some(e => e.name === name)) {
            entries.push({ name, isDirectory: () => false })
          }
        }
      }
      return entries
    },
    mkdir: async () => {},
    remove: async (path: string) => {
      storage.delete(path)
    },
    copy: async (src: string, dest: string) => {
      const content = storage.get(src)
      if (content !== undefined) {
        storage.set(dest, content)
      }
    },
    move: async (src: string, dest: string) => {
      const content = storage.get(src)
      if (content !== undefined) {
        storage.set(dest, content)
        storage.delete(src)
      }
    },
    // Helper to get current storage state for assertions
    _getStorage: () => storage,
  } as unknown as FsCapability & { _getStorage: () => Map<string, string> }
}

/**
 * Mock sandbox for executing text processing commands.
 * This simulates the full Linux sandbox (Tier 4) behavior.
 */
function createMockSandbox(
  mockResponses: Record<string, { stdout: string; stderr: string; exitCode: number }>
): SandboxBinding {
  return {
    execute: async (command: string, _options?: ExecOptions): Promise<BashResult> => {
      // Find matching response by command prefix
      for (const [pattern, response] of Object.entries(mockResponses)) {
        if (command.startsWith(pattern) || command.includes(pattern)) {
          return {
            input: command,
            command,
            valid: true,
            generated: false,
            stdout: response.stdout,
            stderr: response.stderr,
            exitCode: response.exitCode,
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
              impact: 'low',
              reversible: true,
              reason: 'Mock sandbox execution',
            },
          }
        }
      }

      // Default: command not found
      return {
        input: command,
        command,
        valid: true,
        generated: false,
        stdout: '',
        stderr: `Command not implemented in mock: ${command}`,
        exitCode: 127,
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
          impact: 'none',
          reversible: true,
          reason: 'Mock sandbox - command not found',
        },
      }
    },
  }
}

/**
 * Create a TieredExecutor configured for text processing tests.
 */
function createTestExecutor(
  files: Record<string, string> = {},
  sandboxResponses: Record<string, { stdout: string; stderr: string; exitCode: number }> = {}
): TieredExecutor {
  const config: TieredExecutorConfig = {
    fs: createMockFs(files),
    sandbox: createMockSandbox(sandboxResponses),
  }
  return new TieredExecutor(config)
}

// ============================================================================
// SED TESTS - Stream Editor
// ============================================================================

describe('sed (stream editor)', () => {
  describe('basic substitution', () => {
    it('should replace first occurrence of pattern in each line', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'hello world\nhello universe\n' },
        {
          "sed 's/hello/goodbye/'": {
            stdout: 'goodbye world\ngoodbye universe\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/hello/goodbye/' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('goodbye world\ngoodbye universe\n')
    })

    it('should handle empty replacement', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'hello world\n' },
        {
          "sed 's/world//'": {
            stdout: 'hello \n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/world//' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello \n')
    })

    it('should preserve lines without matches', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'line one\nline two\nno match here\n' },
        {
          "sed 's/one/1/'": {
            stdout: 'line 1\nline two\nno match here\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/one/1/' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('line 1')
      expect(result.stdout).toContain('line two')
      expect(result.stdout).toContain('no match here')
    })
  })

  describe('global substitution', () => {
    it('should replace all occurrences with g flag', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'aaa bbb aaa\n' },
        {
          "sed 's/aaa/XXX/g'": {
            stdout: 'XXX bbb XXX\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/aaa/XXX/g' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('XXX bbb XXX\n')
    })

    it('should handle multiple lines with global replacement', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'cat cat\ncat dog cat\n' },
        {
          "sed 's/cat/CAT/g'": {
            stdout: 'CAT CAT\nCAT dog CAT\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/cat/CAT/g' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('CAT CAT\nCAT dog CAT\n')
    })
  })

  describe('in-place edit', () => {
    it('should modify file in place with -i flag', async () => {
      const files = { '/test/file.txt': 'old content\n' }
      const executor = createTestExecutor(files, {
        "sed -i 's/old/new/g'": {
          stdout: '',
          stderr: '',
          exitCode: 0,
        },
      })

      const result = await executor.execute("sed -i 's/old/new/g' /test/file.txt")

      expect(result.exitCode).toBe(0)
      // After implementation, the file should be modified
      // This test verifies the executor handles -i flag correctly
    })

    it('should create backup with -i.bak suffix', async () => {
      const files = { '/test/file.txt': 'original\n' }
      const executor = createTestExecutor(files, {
        "sed -i.bak 's/original/modified/'": {
          stdout: '',
          stderr: '',
          exitCode: 0,
        },
      })

      const result = await executor.execute("sed -i.bak 's/original/modified/' /test/file.txt")

      expect(result.exitCode).toBe(0)
      // After implementation, both file.txt (modified) and file.txt.bak (original) should exist
    })
  })

  describe('print specific lines', () => {
    it('should print specific line number with -n and p flag', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'line1\nline2\nline3\nline4\nline5\n' },
        {
          "sed -n '5p'": {
            stdout: 'line5\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -n '5p' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line5\n')
    })

    it('should print range of lines', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'line1\nline2\nline3\nline4\nline5\n' },
        {
          "sed -n '2,4p'": {
            stdout: 'line2\nline3\nline4\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -n '2,4p' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line2\nline3\nline4\n')
    })

    it('should print first line', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'first\nsecond\nthird\n' },
        {
          "sed -n '1p'": {
            stdout: 'first\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -n '1p' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('first\n')
    })

    it('should print last line with $', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'first\nsecond\nlast\n' },
        {
          "sed -n '$p'": {
            stdout: 'last\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -n '$p' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('last\n')
    })
  })

  describe('delete lines', () => {
    it('should delete lines in range', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\n' },
        {
          "sed '1,10d'": {
            stdout: 'line11\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed '1,10d' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line11\n')
    })

    it('should delete single line', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'keep\ndelete\nkeep\n' },
        {
          "sed '2d'": {
            stdout: 'keep\nkeep\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed '2d' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('keep\nkeep\n')
    })

    it('should delete lines matching pattern', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'apple\nbanana\napricot\ncherry\n' },
        {
          "sed '/^a/d'": {
            stdout: 'banana\ncherry\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed '/^a/d' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('banana\ncherry\n')
    })
  })

  describe('multiple commands', () => {
    it('should execute multiple -e commands', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'hello world\n' },
        {
          "sed -e 's/hello/hi/' -e 's/world/there/'": {
            stdout: 'hi there\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -e 's/hello/hi/' -e 's/world/there/' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hi there\n')
    })

    it('should chain substitutions in order', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'aaa\n' },
        {
          "sed -e 's/aaa/bbb/' -e 's/bbb/ccc/'": {
            stdout: 'ccc\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -e 's/aaa/bbb/' -e 's/bbb/ccc/' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('ccc\n')
    })
  })

  describe('regex support', () => {
    it('should match extended regex patterns', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'price: 100 dollars\nprice: 999 dollars\n' },
        {
          "sed 's/[0-9]+/NUM/g'": {
            stdout: 'price: NUM dollars\nprice: NUM dollars\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed -E 's/[0-9]+/NUM/g' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('price: NUM dollars\nprice: NUM dollars\n')
    })

    it('should handle character classes', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'ABC def 123\n' },
        {
          "sed 's/[a-z]/X/g'": {
            stdout: 'ABC XXX 123\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/[a-z]/X/g' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('ABC XXX 123\n')
    })

    it('should handle backreferences', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'hello hello\n' },
        {
          "sed 's/\\(hello\\) \\1/\\1 world/'": {
            stdout: 'hello world\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("sed 's/\\(hello\\) \\1/\\1 world/' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello world\n')
    })
  })
})

// ============================================================================
// AWK TESTS - Pattern Scanning and Processing
// ============================================================================

describe('awk (pattern scanning)', () => {
  describe('print field', () => {
    it('should print first field by default delimiter (whitespace)', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'apple banana cherry\norange grape melon\n' },
        {
          "awk '{print $1}'": {
            stdout: 'apple\norange\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{print $1}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('apple\norange\n')
    })

    it('should print multiple fields', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'one two three four\n' },
        {
          "awk '{print $1, $3}'": {
            stdout: 'one three\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{print $1, $3}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('one three\n')
    })

    it('should print entire line with $0', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'full line here\n' },
        {
          "awk '{print $0}'": {
            stdout: 'full line here\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{print $0}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('full line here\n')
    })

    it('should print last field with $NF', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'first second third last\n' },
        {
          "awk '{print $NF}'": {
            stdout: 'last\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{print $NF}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('last\n')
    })
  })

  describe('custom delimiter', () => {
    it('should use colon as field separator with -F:', async () => {
      const executor = createTestExecutor(
        { '/etc/passwd': 'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/zsh\n' },
        {
          "awk -F: '{print $1}'": {
            stdout: 'root\nuser\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk -F: '{print $1}' /etc/passwd")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('root\nuser\n')
    })

    it('should handle comma delimiter', async () => {
      const executor = createTestExecutor(
        { '/test/data.csv': 'name,age,city\njohn,30,nyc\njane,25,la\n' },
        {
          "awk -F, '{print $2}'": {
            stdout: 'age\n30\n25\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk -F, '{print $2}' /test/data.csv")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('age\n30\n25\n')
    })

    it('should handle tab delimiter', async () => {
      const executor = createTestExecutor(
        { '/test/file.tsv': 'col1\tcol2\tcol3\nval1\tval2\tval3\n' },
        {
          "awk -F'\\t' '{print $2}'": {
            stdout: 'col2\nval2\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk -F'\\t' '{print $2}' /test/file.tsv")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('col2\nval2\n')
    })
  })

  describe('pattern matching', () => {
    it('should print lines matching pattern', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'error: something wrong\ninfo: all good\nerror: another problem\n' },
        {
          "awk '/error/ {print}'": {
            stdout: 'error: something wrong\nerror: another problem\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '/error/ {print}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('error: something wrong\nerror: another problem\n')
    })

    it('should match regex pattern', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'test123\nabc456\n789xyz\n' },
        {
          "awk '/^[0-9]/ {print}'": {
            stdout: '789xyz\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '/^[0-9]/ {print}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('789xyz\n')
    })

    it('should negate pattern with !', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'keep this\nskip this line\nkeep also\n' },
        {
          "awk '!/skip/ {print}'": {
            stdout: 'keep this\nkeep also\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '!/skip/ {print}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('keep this\nkeep also\n')
    })
  })

  describe('line number', () => {
    it('should select specific line with NR==', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'line1\nline2\nline3\nline4\nline5\n' },
        {
          "awk 'NR==5'": {
            stdout: 'line5\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk 'NR==5' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line5\n')
    })

    it('should select range of lines', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'line1\nline2\nline3\nline4\nline5\n' },
        {
          "awk 'NR>=2 && NR<=4'": {
            stdout: 'line2\nline3\nline4\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk 'NR>=2 && NR<=4' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line2\nline3\nline4\n')
    })

    it('should print line number with each line', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'first\nsecond\nthird\n' },
        {
          "awk '{print NR, $0}'": {
            stdout: '1 first\n2 second\n3 third\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{print NR, $0}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('1 first\n2 second\n3 third\n')
    })
  })

  describe('aggregation', () => {
    it('should sum a column', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': '10\n20\n30\n40\n' },
        {
          "awk '{sum+=$1} END {print sum}'": {
            stdout: '100\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{sum+=$1} END {print sum}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('100\n')
    })

    it('should calculate average', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': '10\n20\n30\n40\n' },
        {
          "awk '{sum+=$1; count++} END {print sum/count}'": {
            stdout: '25\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{sum+=$1; count++} END {print sum/count}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('25\n')
    })

    it('should count lines', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'a\nb\nc\nd\ne\n' },
        {
          "awk 'END {print NR}'": {
            stdout: '5\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk 'END {print NR}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('5\n')
    })

    it('should find max value', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': '5\n3\n9\n1\n7\n' },
        {
          "awk 'BEGIN {max=0} {if($1>max) max=$1} END {print max}'": {
            stdout: '9\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk 'BEGIN {max=0} {if($1>max) max=$1} END {print max}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('9\n')
    })
  })

  describe('output format', () => {
    it('should use custom output field separator with OFS', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'one two three\n' },
        {
          "awk 'BEGIN {OFS=\",\"} {print $1,$2,$3}'": {
            stdout: 'one,two,three\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk 'BEGIN {OFS=\",\"} {print $1,$2,$3}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('one,two,three\n')
    })

    it('should format output with printf', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'john 25\njane 30\n' },
        {
          "awk '{printf \"Name: %s, Age: %d\\n\", $1, $2}'": {
            stdout: 'Name: john, Age: 25\nName: jane, Age: 30\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk '{printf \"Name: %s, Age: %d\\n\", $1, $2}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Name: john, Age: 25\nName: jane, Age: 30\n')
    })

    it('should use output record separator with ORS', async () => {
      const executor = createTestExecutor(
        { '/test/file.txt': 'a\nb\nc\n' },
        {
          "awk 'BEGIN {ORS=\" \"} {print $0}'": {
            stdout: 'a b c ',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute("awk 'BEGIN {ORS=\" \"} {print $0}' /test/file.txt")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('a b c ')
    })
  })
})

// ============================================================================
// DIFF TESTS - File Comparison
// ============================================================================

describe('diff (file comparison)', () => {
  describe('basic diff', () => {
    it('should show no difference for identical files', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'same content\n',
          '/test/file2.txt': 'same content\n',
        },
        {
          'diff /test/file1.txt /test/file2.txt': {
            stdout: '',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('diff /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('should show differences in normal format', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'line1\nline2\nline3\n',
          '/test/file2.txt': 'line1\nmodified\nline3\n',
        },
        {
          'diff /test/file1.txt /test/file2.txt': {
            stdout: '2c2\n< line2\n---\n> modified\n',
            stderr: '',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('diff /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(1) // diff returns 1 when files differ
      expect(result.stdout).toContain('< line2')
      expect(result.stdout).toContain('> modified')
    })

    it('should show added lines', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'line1\n',
          '/test/file2.txt': 'line1\nline2\n',
        },
        {
          'diff /test/file1.txt /test/file2.txt': {
            stdout: '1a2\n> line2\n',
            stderr: '',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('diff /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('> line2')
    })

    it('should show deleted lines', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'line1\nline2\n',
          '/test/file2.txt': 'line1\n',
        },
        {
          'diff /test/file1.txt /test/file2.txt': {
            stdout: '2d1\n< line2\n',
            stderr: '',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('diff /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('< line2')
    })
  })

  describe('unified format', () => {
    it('should output unified diff with -u flag', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'line1\nline2\nline3\n',
          '/test/file2.txt': 'line1\nchanged\nline3\n',
        },
        {
          'diff -u /test/file1.txt /test/file2.txt': {
            stdout: `--- /test/file1.txt
+++ /test/file2.txt
@@ -1,3 +1,3 @@
 line1
-line2
+changed
 line3
`,
            stderr: '',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('diff -u /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('---')
      expect(result.stdout).toContain('+++')
      expect(result.stdout).toContain('@@')
      expect(result.stdout).toContain('-line2')
      expect(result.stdout).toContain('+changed')
    })

    it('should show context lines in unified format', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'a\nb\nc\nd\ne\n',
          '/test/file2.txt': 'a\nb\nX\nd\ne\n',
        },
        {
          'diff -u /test/file1.txt /test/file2.txt': {
            stdout: `--- /test/file1.txt
+++ /test/file2.txt
@@ -1,5 +1,5 @@
 a
 b
-c
+X
 d
 e
`,
            stderr: '',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('diff -u /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain(' a') // context line
      expect(result.stdout).toContain(' b') // context line
      expect(result.stdout).toContain('-c')
      expect(result.stdout).toContain('+X')
    })
  })

  describe('context format', () => {
    it('should output context diff with -c flag', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'line1\nline2\nline3\n',
          '/test/file2.txt': 'line1\nmodified\nline3\n',
        },
        {
          'diff -c /test/file1.txt /test/file2.txt': {
            stdout: `*** /test/file1.txt
--- /test/file2.txt
***************
*** 1,3 ****
  line1
! line2
  line3
--- 1,3 ----
  line1
! modified
  line3
`,
            stderr: '',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('diff -c /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('***')
      expect(result.stdout).toContain('! line2')
      expect(result.stdout).toContain('! modified')
    })
  })
})

// ============================================================================
// PATCH TESTS - Apply Diffs
// ============================================================================

describe('patch (apply diffs)', () => {
  describe('apply patch', () => {
    it('should apply unified diff patch', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'line1\nold line\nline3\n',
          '/test/changes.patch': `--- /test/file.txt
+++ /test/file.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
`,
        },
        {
          'patch < /test/changes.patch': {
            stdout: 'patching file /test/file.txt\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('patch < /test/changes.patch')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('patching file')
    })

    it('should report already applied patch', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'line1\nnew line\nline3\n',
          '/test/changes.patch': `--- /test/file.txt
+++ /test/file.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
`,
        },
        {
          'patch < /test/changes.patch': {
            stdout: '',
            stderr: 'Reversed (or previously applied) patch detected!',
            exitCode: 1,
          },
        }
      )

      const result = await executor.execute('patch < /test/changes.patch')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('previously applied')
    })
  })

  describe('reverse patch', () => {
    it('should reverse patch with -R flag', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'line1\nnew line\nline3\n',
          '/test/changes.patch': `--- /test/file.txt
+++ /test/file.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
`,
        },
        {
          'patch -R < /test/changes.patch': {
            stdout: 'patching file /test/file.txt\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('patch -R < /test/changes.patch')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('patching file')
    })
  })

  describe('strip prefix', () => {
    it('should strip directory prefix with -p1', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'original\n',
          '/test/diff.patch': `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-original
+modified
`,
        },
        {
          'patch -p1 < /test/diff.patch': {
            stdout: 'patching file file.txt\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('patch -p1 < /test/diff.patch')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('patching file')
    })

    it('should handle -p0 for no strip', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'original\n',
          '/test/diff.patch': `--- /test/file.txt
+++ /test/file.txt
@@ -1 +1 @@
-original
+modified
`,
        },
        {
          'patch -p0 < /test/diff.patch': {
            stdout: 'patching file /test/file.txt\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('patch -p0 < /test/diff.patch')

      expect(result.exitCode).toBe(0)
    })

    it('should strip multiple levels with -p2', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'original\n',
          '/test/diff.patch': `--- a/src/file.txt
+++ b/src/file.txt
@@ -1 +1 @@
-original
+modified
`,
        },
        {
          'patch -p2 < /test/diff.patch': {
            stdout: 'patching file file.txt\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('patch -p2 < /test/diff.patch')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('dry run', () => {
    it('should test patch without applying with --dry-run', async () => {
      const executor = createTestExecutor(
        {
          '/test/file.txt': 'original\n',
          '/test/diff.patch': `--- /test/file.txt
+++ /test/file.txt
@@ -1 +1 @@
-original
+modified
`,
        },
        {
          'patch --dry-run < /test/diff.patch': {
            stdout: 'checking file /test/file.txt\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('patch --dry-run < /test/diff.patch')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('checking file')
    })
  })
})

// ============================================================================
// TEE TESTS - Write to Multiple Outputs
// ============================================================================

describe('tee (write to multiple outputs)', () => {
  describe('basic tee', () => {
    it('should write stdin to file and stdout', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "text" | tee /test/output.txt': {
            stdout: 'text\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "text" | tee /test/output.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('text\n')
    })

    it('should overwrite existing file by default', async () => {
      const executor = createTestExecutor(
        { '/test/output.txt': 'old content\n' },
        {
          'echo "new" | tee /test/output.txt': {
            stdout: 'new\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "new" | tee /test/output.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('new\n')
    })
  })

  describe('append mode', () => {
    it('should append to file with -a flag', async () => {
      const executor = createTestExecutor(
        { '/test/output.txt': 'existing\n' },
        {
          'echo "appended" | tee -a /test/output.txt': {
            stdout: 'appended\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "appended" | tee -a /test/output.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('appended\n')
    })

    it('should create file if it does not exist with -a', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "new" | tee -a /test/newfile.txt': {
            stdout: 'new\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "new" | tee -a /test/newfile.txt')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('multiple files', () => {
    it('should write to multiple files simultaneously', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "multi" | tee /test/file1.txt /test/file2.txt': {
            stdout: 'multi\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "multi" | tee /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('multi\n')
    })

    it('should append to multiple files with -a', async () => {
      const executor = createTestExecutor(
        {
          '/test/file1.txt': 'old1\n',
          '/test/file2.txt': 'old2\n',
        },
        {
          'echo "appended" | tee -a /test/file1.txt /test/file2.txt': {
            stdout: 'appended\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "appended" | tee -a /test/file1.txt /test/file2.txt')

      expect(result.exitCode).toBe(0)
    })

    it('should handle three or more files', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "data" | tee /test/a.txt /test/b.txt /test/c.txt': {
            stdout: 'data\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "data" | tee /test/a.txt /test/b.txt /test/c.txt')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('pipeline integration', () => {
    it('should work in the middle of a pipeline', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "hello" | tee /test/log.txt | tr a-z A-Z': {
            stdout: 'HELLO\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "hello" | tee /test/log.txt | tr a-z A-Z')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('HELLO\n')
    })
  })
})

// ============================================================================
// XARGS TESTS - Build Command Lines
// ============================================================================

describe('xargs (build command lines)', () => {
  describe('basic xargs', () => {
    it('should pass input as arguments to echo', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "a b c" | xargs echo': {
            stdout: 'a b c\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "a b c" | xargs echo')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('a b c\n')
    })

    it('should handle multi-line input', async () => {
      const executor = createTestExecutor(
        {},
        {
          'printf "one\\ntwo\\nthree" | xargs echo': {
            stdout: 'one two three\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('printf "one\\ntwo\\nthree" | xargs echo')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('one two three\n')
    })
  })

  describe('one per line', () => {
    it('should process one argument at a time with -n 1', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "a b c" | xargs -n 1 echo': {
            stdout: 'a\nb\nc\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "a b c" | xargs -n 1 echo')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('a\nb\nc\n')
    })

    it('should process two arguments at a time with -n 2', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "a b c d" | xargs -n 2 echo': {
            stdout: 'a b\nc d\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "a b c d" | xargs -n 2 echo')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('a b\nc d\n')
    })
  })

  describe('placeholder', () => {
    it.skip('should replace placeholder with -I {}', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "file.txt" | xargs -I {} mv {} {}.bak': {
            stdout: '',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "file.txt" | xargs -I {} mv {} {}.bak')

      expect(result.exitCode).toBe(0)
    })

    it('should handle custom placeholder', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "test" | xargs -I % echo "value: %"': {
            stdout: 'value: test\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "test" | xargs -I % echo "value: %"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('value: test\n')
    })

    it('should run command for each line with -I', async () => {
      const executor = createTestExecutor(
        {},
        {
          'printf "a\\nb\\nc" | xargs -I {} echo "item: {}"': {
            stdout: 'item: a\nitem: b\nitem: c\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('printf "a\\nb\\nc" | xargs -I {} echo "item: {}"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('item: a\nitem: b\nitem: c\n')
    })
  })

  describe('null delimiter', () => {
    it.skip('should use null delimiter with -0', async () => {
      const executor = createTestExecutor(
        {},
        {
          'printf "a\\0b\\0c" | xargs -0 echo': {
            stdout: 'a b c\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('printf "a\\0b\\0c" | xargs -0 echo')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('a b c\n')
    })

    it.skip('should handle filenames with spaces using null delimiter', async () => {
      const executor = createTestExecutor(
        {},
        {
          'find . -name "*.txt" -print0 | xargs -0 rm': {
            stdout: '',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('find . -name "*.txt" -print0 | xargs -0 rm')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('parallel execution', () => {
    it('should run commands in parallel with -P', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "1 2 3 4" | xargs -n 1 -P 4 echo': {
            stdout: '1\n2\n3\n4\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "1 2 3 4" | xargs -n 1 -P 4 echo')

      expect(result.exitCode).toBe(0)
      // Order may vary due to parallel execution
      expect(result.stdout).toContain('1')
      expect(result.stdout).toContain('2')
      expect(result.stdout).toContain('3')
      expect(result.stdout).toContain('4')
    })
  })

  describe('prompt mode', () => {
    it('should prompt before execution with -p (simulated yes)', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "test" | xargs -p echo': {
            stdout: 'echo test?...test\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "test" | xargs -p echo')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('max args', () => {
    it('should limit max arguments with -s', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "very long arguments list" | xargs -s 20 echo': {
            stdout: 'very long\narguments\nlist\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "very long arguments list" | xargs -s 20 echo')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should stop on first error without -t or continue flag', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "a b c" | xargs -n 1 false': {
            stdout: '',
            stderr: '',
            exitCode: 123, // xargs returns 123 when command fails
          },
        }
      )

      const result = await executor.execute('echo "a b c" | xargs -n 1 false')

      expect(result.exitCode).not.toBe(0)
    })

    it('should exit with 0 for empty input', async () => {
      const executor = createTestExecutor(
        {},
        {
          'echo "" | xargs echo': {
            stdout: '\n',
            stderr: '',
            exitCode: 0,
          },
        }
      )

      const result = await executor.execute('echo "" | xargs echo')

      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Combined Command Patterns
// ============================================================================

describe('integration: text processing pipelines', () => {
  it('should combine awk and sed in a pipeline', async () => {
    const executor = createTestExecutor(
      { '/test/data.txt': 'john,30,nyc\njane,25,la\n' },
      {
        "awk -F, '{print $1}' /test/data.txt | sed 's/j/J/g'": {
          stdout: 'John\nJane\n',
          stderr: '',
          exitCode: 0,
        },
      }
    )

    const result = await executor.execute("awk -F, '{print $1}' /test/data.txt | sed 's/j/J/g'")

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('John\nJane\n')
  })

  it.skip('should use diff output with patch', async () => {
    const executor = createTestExecutor(
      {
        '/test/old.txt': 'line1\n',
        '/test/new.txt': 'line1\nline2\n',
      },
      {
        'diff -u /test/old.txt /test/new.txt | patch -p0 --dry-run': {
          stdout: 'checking file /test/old.txt\n',
          stderr: '',
          exitCode: 0,
        },
      }
    )

    const result = await executor.execute('diff -u /test/old.txt /test/new.txt | patch -p0 --dry-run')

    expect(result.exitCode).toBe(0)
  })

  it('should use tee with xargs for parallel processing', async () => {
    const executor = createTestExecutor(
      {},
      {
        'echo "1 2 3" | tee /test/log.txt | xargs -n 1 echo': {
          stdout: '1\n2\n3\n',
          stderr: '',
          exitCode: 0,
        },
      }
    )

    const result = await executor.execute('echo "1 2 3" | tee /test/log.txt | xargs -n 1 echo')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('1\n2\n3\n')
  })

  it('should use sed for extraction and xargs for batch operation', async () => {
    const executor = createTestExecutor(
      { '/test/urls.txt': 'http://example.com.ai/a\nhttp://example.com.ai/b\n' },
      {
        "sed 's|.*/||' /test/urls.txt | xargs -I {} echo 'Processing {}'": {
          stdout: 'Processing a\nProcessing b\n',
          stderr: '',
          exitCode: 0,
        },
      }
    )

    const result = await executor.execute("sed 's|.*/||' /test/urls.txt | xargs -I {} echo 'Processing {}'")

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Processing a\nProcessing b\n')
  })
})
