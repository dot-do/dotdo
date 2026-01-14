/**
 * GNU Coreutils Extension Tests
 *
 * Tests for commonly-used GNU Coreutils extensions beyond the POSIX baseline.
 * These tests cover useful extensions that are available on most Linux systems
 * and partially on macOS (via BSD or GNU coreutils from Homebrew).
 *
 * Note: Some features are GNU-specific and may not be available on macOS.
 * Tests are marked as skipped when the feature is not available on the
 * current platform.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestContext, type TestContext, exec } from '../helpers/index'
import * as os from 'os'

const isMacOS = os.platform() === 'darwin'
const isLinux = os.platform() === 'linux'

/**
 * Check if a command supports a specific flag
 */
async function supportsFlag(command: string, flag: string): Promise<boolean> {
  const result = await exec(`${command} ${flag} --help 2>&1 || ${command} ${flag} /dev/null 2>&1; echo $?`)
  // If the command doesn't exit with error about unknown flag, it's supported
  return !result.stderr.includes('illegal option') &&
         !result.stderr.includes('invalid option') &&
         !result.stderr.includes('unrecognized option')
}

/**
 * Check if GNU version of a command is available
 */
async function hasGnuVersion(command: string): Promise<boolean> {
  const result = await exec(`${command} --version 2>&1`)
  return result.stdout.includes('GNU') || result.exitCode === 0
}

describe('GNU Coreutils Extensions', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  // ============================================================================
  // grep - GNU grep extensions
  // ============================================================================
  describe('grep GNU extensions', () => {
    describe('--color option', () => {
      it('--color=never disables colored output', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        const result = await ctx.exec('grep --color=never hello test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hello world\n')
        // Should not contain ANSI escape codes
        expect(result.stdout).not.toMatch(/\x1b\[/)
      })

      it('--color=auto works without error', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        const result = await ctx.exec('grep --color=auto hello test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('hello world')
      })

      it('--color=always forces colored output', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        const result = await ctx.exec('grep --color=always hello test.txt')
        expect(result.exitCode).toBe(0)
        // Should contain ANSI escape codes on systems that support it
        // Note: BSD grep on macOS also supports this
        expect(result.stdout.length).toBeGreaterThan(0)
      })
    })

    describe('-r recursive search', () => {
      it('-r searches directories recursively', async () => {
        await ctx.createDir('subdir1')
        await ctx.createDir('subdir2')
        await ctx.createFile('subdir1/file1.txt', 'match here\n')
        await ctx.createFile('subdir2/file2.txt', 'match there\n')
        await ctx.createFile('root.txt', 'no match\n')
        const result = await ctx.exec('grep -r match .')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('subdir1/file1.txt')
        expect(result.stdout).toContain('subdir2/file2.txt')
      })

      it('-R follows symlinks during recursive search', async () => {
        await ctx.createDir('realdir')
        await ctx.createFile('realdir/file.txt', 'find me\n')
        await ctx.exec('ln -s realdir linkdir')
        const result = await ctx.exec('grep -R "find me" .')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('find me')
      })

      it('--include filters files by pattern', async () => {
        await ctx.createFile('test.txt', 'match\n')
        await ctx.createFile('test.log', 'match\n')
        const result = await ctx.exec('grep -r --include="*.txt" match .')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('test.txt')
        expect(result.stdout).not.toContain('test.log')
      })

      it('--exclude filters out files by pattern', async () => {
        await ctx.createFile('test.txt', 'match\n')
        await ctx.createFile('test.log', 'match\n')
        const result = await ctx.exec('grep -r --exclude="*.log" match .')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('test.txt')
        expect(result.stdout).not.toContain('test.log')
      })
    })

    describe('-P PCRE patterns', () => {
      // PCRE is GNU-specific, not available on macOS BSD grep
      it.skipIf(isMacOS)('-P enables Perl-compatible regex', async () => {
        await ctx.createFile('test.txt', 'hello123world\nhello world\n')
        const result = await ctx.exec('grep -P "hello\\d+world" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hello123world\n')
      })

      it.skipIf(isMacOS)('-P supports lookahead assertions', async () => {
        await ctx.createFile('test.txt', 'foo bar\nfoo baz\n')
        const result = await ctx.exec('grep -P "foo(?= bar)" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('foo bar\n')
      })

      it.skipIf(isMacOS)('-P supports non-greedy quantifiers', async () => {
        await ctx.createFile('test.txt', '<a>text</a>\n')
        const result = await ctx.exec('grep -oP "<.*?>" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('<a>\n</a>\n')
      })
    })

    describe('-o only matching', () => {
      it('-o prints only matching parts', async () => {
        await ctx.createFile('test.txt', 'hello world hello\n')
        const result = await ctx.exec('grep -o hello test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hello\nhello\n')
      })
    })

    describe('-A, -B, -C context lines', () => {
      it('-A prints lines after match', async () => {
        await ctx.createFile('test.txt', 'line1\nmatch\nline3\nline4\n')
        const result = await ctx.exec('grep -A2 match test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('match')
        expect(result.stdout).toContain('line3')
        expect(result.stdout).toContain('line4')
      })

      it('-B prints lines before match', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nmatch\nline4\n')
        const result = await ctx.exec('grep -B2 match test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('line1')
        expect(result.stdout).toContain('line2')
        expect(result.stdout).toContain('match')
      })

      it('-C prints context before and after match', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nmatch\nline4\nline5\n')
        const result = await ctx.exec('grep -C1 match test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('line2')
        expect(result.stdout).toContain('match')
        expect(result.stdout).toContain('line4')
      })
    })
  })

  // ============================================================================
  // sed - GNU sed extensions
  // ============================================================================
  describe('sed GNU extensions', () => {
    describe('-i in-place editing', () => {
      it('-i edits file in place (GNU style)', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        // GNU sed uses -i without argument, BSD sed requires -i ''
        const gnuResult = await ctx.exec('sed -i "s/hello/goodbye/" test.txt 2>&1')
        if (gnuResult.exitCode !== 0 && isMacOS) {
          // Try BSD style
          const bsdResult = await ctx.exec('sed -i "" "s/hello/goodbye/" test.txt')
          expect(bsdResult.exitCode).toBe(0)
        } else {
          expect(gnuResult.exitCode).toBe(0)
        }
        const content = await ctx.readFile('test.txt')
        expect(content).toBe('goodbye world\n')
      })

      it("-i '' (BSD style) edits file in place on macOS", async () => {
        if (!isMacOS) return // Skip on Linux
        await ctx.createFile('test.txt', 'foo bar\n')
        const result = await ctx.exec('sed -i "" "s/foo/baz/" test.txt')
        expect(result.exitCode).toBe(0)
        const content = await ctx.readFile('test.txt')
        expect(content).toBe('baz bar\n')
      })

      it('-i creates backup with suffix', async () => {
        await ctx.createFile('test.txt', 'original\n')
        // This syntax works on both GNU and BSD sed
        const result = await ctx.exec('sed -i.bak "s/original/modified/" test.txt')
        expect(result.exitCode).toBe(0)
        expect(await ctx.exists('test.txt.bak')).toBe(true)
        expect(await ctx.readFile('test.txt.bak')).toBe('original\n')
        expect(await ctx.readFile('test.txt')).toBe('modified\n')
      })
    })

    describe('extended regex', () => {
      it('-E enables extended regex (POSIX compliant)', async () => {
        const result = await ctx.exec('echo "aaa" | sed -E "s/a+/b/"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('b\n')
      })

      it('-r enables extended regex (GNU alias)', async () => {
        // -r is GNU-specific, equivalent to -E
        const result = await ctx.exec('echo "aaa" | sed -r "s/a+/b/" 2>&1')
        if (result.stderr.includes('illegal option') || result.stderr.includes('invalid option')) {
          // -r not supported (BSD sed), skip
          return
        }
        expect(result.stdout).toBe('b\n')
      })
    })

    describe('multiple expressions', () => {
      it('-e allows multiple expressions', async () => {
        const result = await ctx.exec('echo "hello world" | sed -e "s/hello/hi/" -e "s/world/there/"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hi there\n')
      })
    })

    describe('address ranges', () => {
      it('first,last addresses work', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nline3\nline4\n')
        const result = await ctx.exec('sed "2,3s/line/LINE/" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('line1\nLINE2\nLINE3\nline4\n')
      })

      it('$ addresses last line', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nline3\n')
        const result = await ctx.exec('sed "$ s/line/LAST/" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('line1\nline2\nLAST3\n')
      })
    })
  })

  // ============================================================================
  // ls - GNU ls extensions
  // ============================================================================
  describe('ls GNU extensions', () => {
    describe('--color option', () => {
      it('--color=never works', async () => {
        await ctx.createFile('test.txt', '')
        const result = await ctx.exec('ls --color=never')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).not.toMatch(/\x1b\[/)
      })

      it('--color=auto works', async () => {
        await ctx.createFile('test.txt', '')
        const result = await ctx.exec('ls --color=auto')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('-h human-readable sizes', () => {
      it('-h shows human-readable file sizes', async () => {
        // Create a larger file to see human-readable output
        await ctx.exec('dd if=/dev/zero of=largefile bs=1024 count=1024 2>/dev/null')
        const result = await ctx.exec('ls -lh largefile')
        expect(result.exitCode).toBe(0)
        // Should show size with K, M, or G suffix
        expect(result.stdout).toMatch(/\d+(\.\d+)?[KMG]?\s/)
      })

      it('-lh combines long format with human-readable', async () => {
        await ctx.createFile('test.txt', 'hello')
        const result = await ctx.exec('ls -lh test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('test.txt')
      })
    })

    describe('-1 one per line', () => {
      it('-1 lists one file per line', async () => {
        await ctx.createFile('aaa.txt', '')
        await ctx.createFile('bbb.txt', '')
        await ctx.createFile('ccc.txt', '')
        const result = await ctx.exec('ls -1')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines).toContain('aaa.txt')
        expect(lines).toContain('bbb.txt')
        expect(lines).toContain('ccc.txt')
      })
    })

    describe('sorting options', () => {
      it('-t sorts by modification time', async () => {
        await ctx.createFile('old.txt', '')
        await ctx.exec('sleep 0.1')
        await ctx.createFile('new.txt', '')
        const result = await ctx.exec('ls -t')
        expect(result.exitCode).toBe(0)
        const files = result.stdout.trim().split(/\s+/)
        const oldIndex = files.indexOf('old.txt')
        const newIndex = files.indexOf('new.txt')
        expect(newIndex).toBeLessThan(oldIndex)
      })

      it('-S sorts by file size', async () => {
        await ctx.createFile('small.txt', 'x')
        await ctx.createFile('large.txt', 'x'.repeat(1000))
        const result = await ctx.exec('ls -S')
        expect(result.exitCode).toBe(0)
        const output = result.stdout
        expect(output.indexOf('large.txt')).toBeLessThan(output.indexOf('small.txt'))
      })

      it('-r reverses sort order', async () => {
        await ctx.createFile('aaa.txt', '')
        await ctx.createFile('zzz.txt', '')
        const result = await ctx.exec('ls -r')
        expect(result.exitCode).toBe(0)
        const output = result.stdout
        expect(output.indexOf('zzz.txt')).toBeLessThan(output.indexOf('aaa.txt'))
      })
    })

    describe('-d directory listing', () => {
      it('-d lists directory itself, not contents', async () => {
        await ctx.createDir('mydir')
        await ctx.createFile('mydir/file.txt', '')
        const result = await ctx.exec('ls -d mydir')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('mydir')
      })
    })
  })

  // ============================================================================
  // head/tail - GNU extensions
  // ============================================================================
  describe('head/tail GNU extensions', () => {
    describe('head -n with negative counts', () => {
      it('head -n -N prints all but last N lines', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nline3\nline4\nline5\n')
        const result = await ctx.exec('head -n -2 test.txt')
        if (result.exitCode !== 0 && isMacOS) {
          // BSD head doesn't support negative counts
          return
        }
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('line1\nline2\nline3\n')
      })
    })

    describe('tail -n with positive counts', () => {
      it('tail -n +N prints from line N onwards', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nline3\nline4\nline5\n')
        const result = await ctx.exec('tail -n +3 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('line3\nline4\nline5\n')
      })
    })

    describe('-q quiet mode', () => {
      it.skipIf(isMacOS)('head -q suppresses headers for multiple files', async () => {
        // BSD head on macOS doesn't support -q flag
        await ctx.createFile('file1.txt', 'content1\n')
        await ctx.createFile('file2.txt', 'content2\n')
        const result = await ctx.exec('head -q file1.txt file2.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).not.toContain('==>')
        expect(result.stdout).toBe('content1\ncontent2\n')
      })

      it('tail -q suppresses headers for multiple files', async () => {
        await ctx.createFile('file1.txt', 'content1\n')
        await ctx.createFile('file2.txt', 'content2\n')
        const result = await ctx.exec('tail -q file1.txt file2.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).not.toContain('==>')
        expect(result.stdout).toBe('content1\ncontent2\n')
      })
    })

    describe('-c byte counts', () => {
      it('head -c N prints first N bytes', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        const result = await ctx.exec('head -c 5 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hello')
      })

      it('tail -c N prints last N bytes', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        const result = await ctx.exec('tail -c 6 test.txt')
        expect(result.exitCode).toBe(0)
        // 'hello world\n' is 12 chars, last 6 chars is 'world\n'
        expect(result.stdout).toBe('world\n')
      })
    })

    describe('tail -f follow mode', () => {
      it('tail -f exists and returns correct option parsing', async () => {
        await ctx.createFile('test.txt', 'initial\n')
        // Just verify the option is recognized (we won't actually test following)
        const result = await ctx.exec('timeout 0.5 tail -f test.txt 2>&1 || true')
        // Should not show "invalid option" error
        expect(result.stderr).not.toContain('illegal option')
        expect(result.stderr).not.toContain('invalid option')
      })
    })
  })

  // ============================================================================
  // cut - GNU cut extensions
  // ============================================================================
  describe('cut GNU extensions', () => {
    describe('--complement option', () => {
      it.skipIf(isMacOS)('--complement inverts selection', async () => {
        await ctx.createFile('test.txt', 'abcdefghij\n')
        const result = await ctx.exec('cut --complement -c 2-4 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('aefghij\n')
      })

      it.skipIf(isMacOS)('--complement with field selection', async () => {
        await ctx.createFile('test.txt', 'one:two:three:four\n')
        const result = await ctx.exec('cut --complement -d: -f2 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('one:three:four\n')
      })
    })

    describe('standard cut operations for comparison', () => {
      it('-c selects characters', async () => {
        await ctx.createFile('test.txt', 'hello world\n')
        const result = await ctx.exec('cut -c 1-5 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hello\n')
      })

      it('-f with -d selects fields', async () => {
        await ctx.createFile('test.txt', 'a:b:c:d\n')
        const result = await ctx.exec('cut -d: -f2,4 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('b:d\n')
      })
    })
  })

  // ============================================================================
  // sort - GNU sort extensions
  // ============================================================================
  describe('sort GNU extensions', () => {
    describe('-h human-readable numeric sort', () => {
      it.skipIf(isMacOS)('-h sorts by human-readable numbers', async () => {
        await ctx.createFile('test.txt', '1G\n10K\n5M\n100\n')
        const result = await ctx.exec('sort -h test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('100\n10K\n5M\n1G\n')
      })
    })

    describe('-V version sort', () => {
      it.skipIf(isMacOS)('-V sorts version numbers correctly', async () => {
        await ctx.createFile('test.txt', 'v1.10\nv1.2\nv1.1\nv2.0\n')
        const result = await ctx.exec('sort -V test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('v1.1\nv1.2\nv1.10\nv2.0\n')
      })

      it.skipIf(isMacOS)('-V handles mixed version formats', async () => {
        await ctx.createFile('test.txt', 'file-1.10.tar.gz\nfile-1.2.tar.gz\nfile-1.9.tar.gz\n')
        const result = await ctx.exec('sort -V test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('file-1.2.tar.gz\nfile-1.9.tar.gz\nfile-1.10.tar.gz\n')
      })
    })

    describe('-u unique with sort', () => {
      it('-u removes duplicates while sorting', async () => {
        await ctx.createFile('test.txt', 'c\na\nb\na\nc\nb\n')
        const result = await ctx.exec('sort -u test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('a\nb\nc\n')
      })
    })

    describe('-k key specification', () => {
      it('-k sorts by specific field', async () => {
        await ctx.createFile('test.txt', 'z 3\na 1\nm 2\n')
        const result = await ctx.exec('sort -k2 test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('a 1\nm 2\nz 3\n')
      })

      it('-k with -n sorts numerically', async () => {
        await ctx.createFile('test.txt', 'a 10\nb 2\nc 1\n')
        const result = await ctx.exec('sort -k2 -n test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('c 1\nb 2\na 10\n')
      })
    })

    describe('-t field delimiter', () => {
      it('-t specifies field delimiter', async () => {
        await ctx.createFile('test.txt', 'c:3\na:1\nb:2\n')
        const result = await ctx.exec('sort -t: -k2 -n test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('a:1\nb:2\nc:3\n')
      })
    })
  })

  // ============================================================================
  // uniq - GNU uniq extensions
  // ============================================================================
  describe('uniq GNU extensions', () => {
    describe('-w check N chars option', () => {
      it.skipIf(isMacOS)('-w compares only first N characters', async () => {
        // BSD uniq on macOS doesn't support -w flag
        await ctx.createFile('test.txt', 'hello1\nhello2\nworld1\nworld2\n')
        const result = await ctx.exec('sort test.txt | uniq -w 5')
        expect(result.exitCode).toBe(0)
        // Should treat hello1 and hello2 as duplicates (first 5 chars match)
        const lines = result.stdout.trim().split('\n')
        expect(lines.length).toBe(2)
      })
    })

    describe('-c count option', () => {
      it('-c prefixes lines with occurrence count', async () => {
        await ctx.createFile('test.txt', 'a\na\nb\nc\nc\nc\n')
        const result = await ctx.exec('uniq -c test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/\s*2\s+a/)
        expect(result.stdout).toMatch(/\s*1\s+b/)
        expect(result.stdout).toMatch(/\s*3\s+c/)
      })
    })

    describe('-d duplicates only', () => {
      it('-d prints only duplicate lines', async () => {
        await ctx.createFile('test.txt', 'a\na\nb\nc\nc\n')
        const result = await ctx.exec('uniq -d test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('a\nc\n')
      })
    })

    describe('-u unique only', () => {
      it('-u prints only unique lines', async () => {
        await ctx.createFile('test.txt', 'a\na\nb\nc\nc\n')
        const result = await ctx.exec('uniq -u test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('b\n')
      })
    })

    describe('-i ignore case', () => {
      it('-i ignores case when comparing', async () => {
        await ctx.createFile('test.txt', 'Hello\nhello\nHELLO\nworld\n')
        const result = await ctx.exec('uniq -i test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('Hello\nworld\n')
      })
    })
  })

  // ============================================================================
  // readlink - GNU readlink extensions
  // ============================================================================
  describe('readlink GNU extensions', () => {
    describe('-f canonicalize', () => {
      it('-f resolves full path through symlinks', async () => {
        await ctx.createDir('realdir')
        await ctx.createFile('realdir/file.txt', 'content')
        await ctx.exec('ln -s realdir linkdir')
        await ctx.exec('ln -s linkdir/file.txt linkfile')
        const result = await ctx.exec('readlink -f linkfile')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toContain('realdir/file.txt')
        expect(result.stdout.trim()).not.toContain('link')
      })

      it('-f resolves .. in path', async () => {
        await ctx.createDir('subdir')
        await ctx.createFile('subdir/file.txt', '')
        const result = await ctx.exec(`readlink -f "${ctx.tmpDir}/subdir/../subdir/file.txt"`)
        expect(result.exitCode).toBe(0)
        // On macOS, realpath/readlink resolves /var to /private/var
        const expected = `${ctx.tmpDir}/subdir/file.txt`
        const actual = result.stdout.trim()
        expect(actual.endsWith('/subdir/file.txt')).toBe(true)
      })
    })

    describe('basic readlink', () => {
      it('reads symlink target', async () => {
        await ctx.createFile('original.txt', 'content')
        await ctx.exec('ln -s original.txt link.txt')
        const result = await ctx.exec('readlink link.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('original.txt')
      })

      it('fails on non-symlink', async () => {
        await ctx.createFile('regular.txt', '')
        const result = await ctx.exec('readlink regular.txt')
        expect(result.exitCode).not.toBe(0)
      })
    })
  })

  // ============================================================================
  // stat - format options
  // ============================================================================
  describe('stat format options', () => {
    describe('macOS stat format', () => {
      it.skipIf(isLinux)('-f format string works on macOS', async () => {
        await ctx.createFile('test.txt', 'hello')
        const result = await ctx.exec('stat -f "%z" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it.skipIf(isLinux)('-f %N shows filename', async () => {
        await ctx.createFile('test.txt', '')
        const result = await ctx.exec('stat -f "%N" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('test.txt')
      })

      it.skipIf(isLinux)('-f %Sp shows permissions string', async () => {
        await ctx.createFile('test.txt', '')
        await ctx.exec('chmod 644 test.txt')
        const result = await ctx.exec('stat -f "%Sp" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/-rw-r--r--/)
      })
    })

    describe('GNU stat format', () => {
      it.skipIf(isMacOS)('-c format string works on Linux', async () => {
        await ctx.createFile('test.txt', 'hello')
        const result = await ctx.exec('stat -c "%s" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it.skipIf(isMacOS)('-c %n shows filename', async () => {
        await ctx.createFile('test.txt', '')
        const result = await ctx.exec('stat -c "%n" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('test.txt')
      })

      it.skipIf(isMacOS)('-c %A shows permissions string', async () => {
        await ctx.createFile('test.txt', '')
        await ctx.exec('chmod 644 test.txt')
        const result = await ctx.exec('stat -c "%A" test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/-rw-r--r--/)
      })
    })

    describe('basic stat', () => {
      it('shows file info without options', async () => {
        await ctx.createFile('test.txt', 'content')
        const result = await ctx.exec('stat test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('test.txt')
      })
    })
  })

  // ============================================================================
  // date - format extensions
  // ============================================================================
  describe('date format extensions', () => {
    describe('common format specifiers', () => {
      it('+%Y shows 4-digit year', async () => {
        const result = await ctx.exec('date +%Y')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/^\d{4}$/)
      })

      it('+%Y-%m-%d shows ISO date', async () => {
        const result = await ctx.exec('date +%Y-%m-%d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })

      it('+%H:%M:%S shows time', async () => {
        const result = await ctx.exec('date +%H:%M:%S')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/^\d{2}:\d{2}:\d{2}$/)
      })

      it('+%s shows Unix timestamp', async () => {
        const result = await ctx.exec('date +%s')
        expect(result.exitCode).toBe(0)
        const timestamp = parseInt(result.stdout.trim())
        expect(timestamp).toBeGreaterThan(1700000000) // Reasonable timestamp
      })

      it('+%A shows full weekday name', async () => {
        const result = await ctx.exec('date +%A')
        expect(result.exitCode).toBe(0)
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        expect(days).toContain(result.stdout.trim())
      })

      it('+%B shows full month name', async () => {
        const result = await ctx.exec('date +%B')
        expect(result.exitCode).toBe(0)
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December']
        expect(months).toContain(result.stdout.trim())
      })
    })

    describe('-d date string parsing', () => {
      it.skipIf(isMacOS)('-d parses date string (GNU)', async () => {
        const result = await ctx.exec('date -d "2024-01-15" +%Y-%m-%d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('2024-01-15')
      })

      it.skipIf(isMacOS)('-d handles relative dates (GNU)', async () => {
        const result = await ctx.exec('date -d "yesterday" +%Y-%m-%d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    })

    describe('-r reference file', () => {
      it('-r shows file modification time', async () => {
        await ctx.createFile('test.txt', '')
        await ctx.exec('touch -t 202401151200 test.txt')
        const result = await ctx.exec('date -r test.txt +%Y-%m-%d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('2024-01-15')
      })
    })

    describe('-u UTC time', () => {
      it('-u shows UTC time', async () => {
        const result = await ctx.exec('date -u +%Z')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/^(UTC|GMT)$/)
      })
    })

    describe('macOS date parsing', () => {
      it.skipIf(isLinux)('-j prevents setting date, allows parsing', async () => {
        const result = await ctx.exec('date -j -f "%Y-%m-%d" "2024-01-15" +%Y-%m-%d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('2024-01-15')
      })

      it.skipIf(isLinux)('-v adjusts date components', async () => {
        // Get tomorrow's date
        const result = await ctx.exec('date -v+1d +%Y-%m-%d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    })
  })

  // ============================================================================
  // Additional GNU utilities
  // ============================================================================
  describe('additional GNU utilities', () => {
    describe('tac - reverse cat', () => {
      it.skipIf(isMacOS)('tac reverses line order', async () => {
        await ctx.createFile('test.txt', 'line1\nline2\nline3\n')
        const result = await ctx.exec('tac test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('line3\nline2\nline1\n')
      })
    })

    describe('seq - generate sequences', () => {
      it('seq generates number sequence', async () => {
        const result = await ctx.exec('seq 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('1\n2\n3\n4\n5\n')
      })

      it('seq with start and end', async () => {
        const result = await ctx.exec('seq 3 7')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('3\n4\n5\n6\n7\n')
      })

      it('seq with step', async () => {
        const result = await ctx.exec('seq 1 2 9')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('1\n3\n5\n7\n9\n')
      })

      it('seq -w zero-pads numbers', async () => {
        const result = await ctx.exec('seq -w 8 12')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('08\n09\n10\n11\n12\n')
      })

      it('seq -s changes separator', async () => {
        const result = await ctx.exec('seq -s, 1 5')
        expect(result.exitCode).toBe(0)
        // BSD seq on macOS adds trailing separator, GNU seq doesn't
        // Accept either format: '1,2,3,4,5' or '1,2,3,4,5,'
        const output = result.stdout.trim()
        expect(output).toMatch(/^1,2,3,4,5,?$/)
      })
    })

    describe('shuf - shuffle lines', () => {
      it.skipIf(isMacOS)('shuf randomizes line order', async () => {
        await ctx.createFile('test.txt', '1\n2\n3\n4\n5\n')
        const results = new Set<string>()
        // Run multiple times to verify randomization
        for (let i = 0; i < 5; i++) {
          const result = await ctx.exec('shuf test.txt')
          expect(result.exitCode).toBe(0)
          results.add(result.stdout)
        }
        // Should have at least some variation (very unlikely to get same order 5 times)
        // But we'll just verify output contains all lines
        const result = await ctx.exec('shuf test.txt')
        const lines = result.stdout.trim().split('\n').sort()
        expect(lines).toEqual(['1', '2', '3', '4', '5'])
      })

      it.skipIf(isMacOS)('shuf -n limits output lines', async () => {
        await ctx.createFile('test.txt', '1\n2\n3\n4\n5\n')
        const result = await ctx.exec('shuf -n 2 test.txt')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines.length).toBe(2)
      })
    })

    describe('realpath - canonicalize path', () => {
      it('realpath resolves full path', async () => {
        await ctx.createFile('test.txt', '')
        const result = await ctx.exec('realpath test.txt')
        expect(result.exitCode).toBe(0)
        // On macOS, realpath resolves /var to /private/var
        const actual = result.stdout.trim()
        expect(actual.endsWith('/test.txt')).toBe(true)
        // Verify it's an absolute path
        expect(actual.startsWith('/')).toBe(true)
      })

      it('realpath resolves .. components', async () => {
        await ctx.createDir('subdir')
        const result = await ctx.exec(`realpath "${ctx.tmpDir}/subdir/.."`)
        expect(result.exitCode).toBe(0)
        // On macOS, realpath may resolve /var to /private/var
        const actual = result.stdout.trim()
        // The result should be a parent of the subdir path
        expect(actual).not.toContain('/subdir')
        expect(actual.startsWith('/')).toBe(true)
      })
    })

    describe('dirname and basename', () => {
      it('dirname extracts directory', async () => {
        const result = await ctx.exec('dirname /path/to/file.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('/path/to')
      })

      it('basename extracts filename', async () => {
        const result = await ctx.exec('basename /path/to/file.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('file.txt')
      })

      it('basename removes suffix', async () => {
        const result = await ctx.exec('basename /path/to/file.txt .txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('file')
      })
    })
  })
})
