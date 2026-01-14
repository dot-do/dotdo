/**
 * Extended Utility Commands Tests
 *
 * Comprehensive tests for extended utility commands:
 * - env: Run with modified environment
 * - id: Print user/group identity
 * - uname: Print system info
 * - timeout: Run command with time limit
 * - tac: Reverse line order
 * - shuf: Shuffle lines
 *
 * @module bashx/do/commands/extended-utils.test
 */

import { describe, it, expect } from 'vitest'
import {
  // env
  parseEnvArgs,
  executeEnv,
  formatEnv,
  // id
  parseIdArgs,
  executeId,
  DEFAULT_WORKER_IDENTITY,
  type IdentityInfo,
  // uname
  parseUnameArgs,
  executeUname,
  DEFAULT_WORKER_SYSINFO,
  type SystemInfo,
  // timeout
  parseTimeoutArgs,
  parseTimeoutDuration,
  parseSignal,
  executeTimeout,
  // tac
  parseTacArgs,
  executeTac,
  // shuf
  parseShufArgs,
  executeShuf,
  // command set
  EXTENDED_UTILS_COMMANDS,
  isExtendedUtilsCommand,
} from './extended-utils.js'

// ============================================================================
// ENV COMMAND TESTS
// ============================================================================

describe('env command', () => {
  describe('parseEnvArgs', () => {
    it('parses -i flag for empty environment', () => {
      const result = parseEnvArgs(['-i', 'ls'])
      expect(result.ignoreEnvironment).toBe(true)
      expect(result.command).toEqual(['ls'])
    })

    it('parses VAR=value assignments', () => {
      const result = parseEnvArgs(['FOO=bar', 'BAZ=qux', 'ls', '-la'])
      expect(result.variables).toEqual({ FOO: 'bar', BAZ: 'qux' })
      expect(result.command).toEqual(['ls', '-la'])
    })

    it('parses -u flag for unsetting variables', () => {
      const result = parseEnvArgs(['-u', 'PATH', '-u', 'HOME', 'ls'])
      expect(result.unset).toEqual(['PATH', 'HOME'])
      expect(result.command).toEqual(['ls'])
    })

    it('parses -uVAR form', () => {
      const result = parseEnvArgs(['-uPATH', 'ls'])
      expect(result.unset).toEqual(['PATH'])
    })

    it('parses -- to end options', () => {
      const result = parseEnvArgs(['FOO=bar', '--', '-i', 'cmd'])
      expect(result.variables).toEqual({ FOO: 'bar' })
      expect(result.command).toEqual(['-i', 'cmd'])
    })

    it('handles complex assignments with equals in value', () => {
      const result = parseEnvArgs(['FOO=a=b=c', 'ls'])
      expect(result.variables).toEqual({ FOO: 'a=b=c' })
    })
  })

  describe('executeEnv', () => {
    it('returns base environment when no options', () => {
      const result = executeEnv({ HOME: '/home/user' }, {})
      expect(result.env).toEqual({ HOME: '/home/user' })
      expect(result.command).toBeUndefined()
    })

    it('starts with empty environment with ignoreEnvironment', () => {
      const result = executeEnv({ HOME: '/home/user' }, { ignoreEnvironment: true })
      expect(result.env).toEqual({})
    })

    it('adds variables to environment', () => {
      const result = executeEnv(
        { HOME: '/home/user' },
        { variables: { FOO: 'bar', BAZ: 'qux' } }
      )
      expect(result.env).toEqual({ HOME: '/home/user', FOO: 'bar', BAZ: 'qux' })
    })

    it('unsets specified variables', () => {
      const result = executeEnv(
        { HOME: '/home/user', PATH: '/bin' },
        { unset: ['PATH'] }
      )
      expect(result.env).toEqual({ HOME: '/home/user' })
    })

    it('combines all options correctly', () => {
      const result = executeEnv(
        { HOME: '/home/user', PATH: '/bin', SHELL: '/bin/bash' },
        {
          unset: ['SHELL'],
          variables: { NEW_VAR: 'value' },
          command: ['ls', '-la'],
        }
      )
      expect(result.env).toEqual({ HOME: '/home/user', PATH: '/bin', NEW_VAR: 'value' })
      expect(result.command).toEqual(['ls', '-la'])
    })
  })

  describe('formatEnv', () => {
    it('formats environment variables', () => {
      const result = formatEnv({ FOO: 'bar', BAZ: 'qux' })
      expect(result).toBe('BAZ=qux\nFOO=bar\n')
    })

    it('sorts variables alphabetically', () => {
      const result = formatEnv({ Z: '1', A: '2', M: '3' })
      expect(result).toBe('A=2\nM=3\nZ=1\n')
    })

    it('handles empty environment', () => {
      const result = formatEnv({})
      expect(result).toBe('')
    })
  })
})

// ============================================================================
// ID COMMAND TESTS
// ============================================================================

describe('id command', () => {
  const testIdentity: IdentityInfo = {
    uid: 1000,
    gid: 1000,
    username: 'testuser',
    groupname: 'testgroup',
    groups: [
      { gid: 1000, name: 'testgroup' },
      { gid: 27, name: 'sudo' },
    ],
    euid: 0,
    egid: 0,
  }

  describe('parseIdArgs', () => {
    it('parses -u flag', () => {
      const result = parseIdArgs(['-u'])
      expect(result.user).toBe(true)
    })

    it('parses -g flag', () => {
      const result = parseIdArgs(['-g'])
      expect(result.group).toBe(true)
    })

    it('parses -n flag', () => {
      const result = parseIdArgs(['-n'])
      expect(result.name).toBe(true)
    })

    it('parses -r flag', () => {
      const result = parseIdArgs(['-r'])
      expect(result.real).toBe(true)
    })

    it('parses -G flag', () => {
      const result = parseIdArgs(['-G'])
      expect(result.groups).toBe(true)
    })

    it('parses combined flags', () => {
      const result = parseIdArgs(['-u', '-n', '-r'])
      expect(result).toEqual({
        user: true,
        name: true,
        real: true,
      })
    })

    it('parses username argument', () => {
      const result = parseIdArgs(['someuser'])
      expect(result.username).toBe('someuser')
    })
  })

  describe('executeId', () => {
    it('outputs full identity by default', () => {
      const result = executeId(testIdentity)
      expect(result).toContain('uid=1000(testuser)')
      expect(result).toContain('gid=1000(testgroup)')
      expect(result).toContain('groups=')
    })

    it('outputs only UID with -u', () => {
      const result = executeId(testIdentity, { user: true })
      expect(result).toBe('0') // effective UID
    })

    it('outputs real UID with -u -r', () => {
      const result = executeId(testIdentity, { user: true, real: true })
      expect(result).toBe('1000')
    })

    it('outputs username with -u -n', () => {
      const result = executeId(testIdentity, { user: true, name: true })
      expect(result).toBe('testuser')
    })

    it('outputs only GID with -g', () => {
      const result = executeId(testIdentity, { group: true })
      expect(result).toBe('0') // effective GID
    })

    it('outputs groupname with -g -n', () => {
      const result = executeId(testIdentity, { group: true, name: true })
      expect(result).toBe('testgroup')
    })

    it('outputs all groups with -G', () => {
      const result = executeId(testIdentity, { groups: true })
      expect(result).toBe('1000 27')
    })

    it('outputs group names with -G -n', () => {
      const result = executeId(testIdentity, { groups: true, name: true })
      expect(result).toBe('testgroup sudo')
    })
  })

  describe('DEFAULT_WORKER_IDENTITY', () => {
    it('has worker as default user', () => {
      expect(DEFAULT_WORKER_IDENTITY.username).toBe('worker')
      expect(DEFAULT_WORKER_IDENTITY.uid).toBe(1000)
    })
  })
})

// ============================================================================
// UNAME COMMAND TESTS
// ============================================================================

describe('uname command', () => {
  const testSysinfo: SystemInfo = {
    kernelName: 'Linux',
    nodeName: 'hostname',
    kernelRelease: '5.15.0',
    kernelVersion: '#1 SMP Tue Nov 8',
    machine: 'x86_64',
    processor: 'x86_64',
    hardwarePlatform: 'x86_64',
    operatingSystem: 'GNU/Linux',
  }

  describe('parseUnameArgs', () => {
    it('defaults to -s when no options', () => {
      const result = parseUnameArgs([])
      expect(result.kernelName).toBe(true)
    })

    it('parses -a flag', () => {
      const result = parseUnameArgs(['-a'])
      expect(result.all).toBe(true)
    })

    it('parses individual flags', () => {
      expect(parseUnameArgs(['-s']).kernelName).toBe(true)
      expect(parseUnameArgs(['-n']).nodeName).toBe(true)
      expect(parseUnameArgs(['-r']).kernelRelease).toBe(true)
      expect(parseUnameArgs(['-v']).kernelVersion).toBe(true)
      expect(parseUnameArgs(['-m']).machine).toBe(true)
      expect(parseUnameArgs(['-o']).operatingSystem).toBe(true)
    })

    it('parses long options', () => {
      expect(parseUnameArgs(['--all']).all).toBe(true)
      expect(parseUnameArgs(['--kernel-name']).kernelName).toBe(true)
      expect(parseUnameArgs(['--nodename']).nodeName).toBe(true)
    })
  })

  describe('executeUname', () => {
    it('outputs kernel name by default', () => {
      const result = executeUname(testSysinfo)
      expect(result).toBe('Linux')
    })

    it('outputs all info with -a', () => {
      const result = executeUname(testSysinfo, { all: true })
      expect(result).toBe('Linux hostname 5.15.0 #1 SMP Tue Nov 8 x86_64 x86_64 x86_64 GNU/Linux')
    })

    it('outputs node name with -n', () => {
      const result = executeUname(testSysinfo, { nodeName: true })
      expect(result).toBe('hostname')
    })

    it('outputs kernel release with -r', () => {
      const result = executeUname(testSysinfo, { kernelRelease: true })
      expect(result).toBe('5.15.0')
    })

    it('outputs machine with -m', () => {
      const result = executeUname(testSysinfo, { machine: true })
      expect(result).toBe('x86_64')
    })

    it('outputs OS with -o', () => {
      const result = executeUname(testSysinfo, { operatingSystem: true })
      expect(result).toBe('GNU/Linux')
    })

    it('combines multiple flags', () => {
      const result = executeUname(testSysinfo, { kernelName: true, machine: true })
      expect(result).toBe('Linux x86_64')
    })
  })

  describe('DEFAULT_WORKER_SYSINFO', () => {
    it('reports CloudflareWorkers as kernel', () => {
      expect(DEFAULT_WORKER_SYSINFO.kernelName).toBe('CloudflareWorkers')
      expect(DEFAULT_WORKER_SYSINFO.machine).toBe('wasm32')
    })
  })
})

// ============================================================================
// TIMEOUT COMMAND TESTS
// ============================================================================

describe('timeout command', () => {
  describe('parseTimeoutDuration', () => {
    it('parses seconds without suffix', () => {
      expect(parseTimeoutDuration('5')).toBe(5000)
    })

    it('parses seconds with s suffix', () => {
      expect(parseTimeoutDuration('5s')).toBe(5000)
    })

    it('parses minutes', () => {
      expect(parseTimeoutDuration('2m')).toBe(120000)
    })

    it('parses hours', () => {
      expect(parseTimeoutDuration('1h')).toBe(3600000)
    })

    it('parses days', () => {
      expect(parseTimeoutDuration('1d')).toBe(86400000)
    })

    it('parses fractional values', () => {
      expect(parseTimeoutDuration('0.5s')).toBe(500)
      expect(parseTimeoutDuration('1.5m')).toBe(90000)
    })

    it('parses infinity', () => {
      expect(parseTimeoutDuration('infinity')).toBe(Infinity)
    })

    it('throws for invalid duration', () => {
      expect(() => parseTimeoutDuration('abc')).toThrow('Invalid duration')
      expect(() => parseTimeoutDuration('-5s')).toThrow('Invalid duration')
    })
  })

  describe('parseSignal', () => {
    it('parses signal names', () => {
      expect(parseSignal('TERM')).toBe(15)
      expect(parseSignal('SIGTERM')).toBe(15)
      expect(parseSignal('KILL')).toBe(9)
      expect(parseSignal('SIGKILL')).toBe(9)
      expect(parseSignal('INT')).toBe(2)
      expect(parseSignal('HUP')).toBe(1)
    })

    it('parses signal numbers as strings', () => {
      expect(parseSignal('15')).toBe(15)
      expect(parseSignal('9')).toBe(9)
    })

    it('parses numeric signals', () => {
      expect(parseSignal(15)).toBe(15)
      expect(parseSignal(9)).toBe(9)
    })

    it('handles case insensitivity', () => {
      expect(parseSignal('term')).toBe(15)
      expect(parseSignal('Term')).toBe(15)
    })
  })

  describe('parseTimeoutArgs', () => {
    it('parses duration and command', () => {
      const result = parseTimeoutArgs(['5s', 'sleep', '10'])
      expect(result.options.duration).toBe('5s')
      expect(result.command).toEqual(['sleep', '10'])
    })

    it('parses -s signal option', () => {
      const result = parseTimeoutArgs(['-s', 'KILL', '5s', 'cmd'])
      expect(result.options.signal).toBe('KILL')
    })

    it('parses -k kill-after option', () => {
      const result = parseTimeoutArgs(['-k', '10s', '5s', 'cmd'])
      expect(result.options.killAfter).toBe('10s')
    })

    it('parses --preserve-status', () => {
      const result = parseTimeoutArgs(['--preserve-status', '5s', 'cmd'])
      expect(result.options.preserveStatus).toBe(true)
    })

    it('parses -v verbose', () => {
      const result = parseTimeoutArgs(['-v', '5s', 'cmd'])
      expect(result.options.verbose).toBe(true)
    })
  })

  describe('executeTimeout', () => {
    it('returns result when command completes in time', async () => {
      const mockExecutor = async () => ({
        exitCode: 0,
        stdout: 'output',
        stderr: '',
      })

      const result = await executeTimeout(
        { duration: '5s' },
        'echo test',
        mockExecutor
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('output')
      expect(result.timedOut).toBe(false)
    })

    it('returns exit code 124 when command times out', async () => {
      const mockExecutor = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { exitCode: 0, stdout: '', stderr: '' }
      }

      const result = await executeTimeout(
        { duration: '0.01s' },
        'slow-command',
        mockExecutor
      )

      expect(result.exitCode).toBe(124)
      expect(result.timedOut).toBe(true)
    })

    it('returns 128+signal with preserve-status', async () => {
      const mockExecutor = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { exitCode: 0, stdout: '', stderr: '' }
      }

      const result = await executeTimeout(
        { duration: '0.01s', preserveStatus: true },
        'slow-command',
        mockExecutor
      )

      expect(result.exitCode).toBe(128 + 15) // 143
      expect(result.timedOut).toBe(true)
    })

    it('includes verbose message when verbose is true', async () => {
      const mockExecutor = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { exitCode: 0, stdout: '', stderr: '' }
      }

      const result = await executeTimeout(
        { duration: '0.01s', verbose: true },
        'slow-command',
        mockExecutor
      )

      expect(result.stderr).toContain('sending signal')
      expect(result.stderr).toContain('slow-command')
    })

    it('returns 125 for invalid duration', async () => {
      const mockExecutor = async () => ({ exitCode: 0, stdout: '', stderr: '' })

      const result = await executeTimeout(
        { duration: 'invalid' },
        'cmd',
        mockExecutor
      )

      expect(result.exitCode).toBe(125)
      expect(result.timedOut).toBe(false)
    })
  })
})

// ============================================================================
// TAC COMMAND TESTS
// ============================================================================

describe('tac command', () => {
  describe('parseTacArgs', () => {
    it('parses file arguments', () => {
      const result = parseTacArgs(['file1.txt', 'file2.txt'])
      expect(result.files).toEqual(['file1.txt', 'file2.txt'])
    })

    it('parses -s separator option', () => {
      const result = parseTacArgs(['-s', '|', 'file.txt'])
      expect(result.options.separator).toBe('|')
      expect(result.files).toEqual(['file.txt'])
    })

    it('parses -b before option', () => {
      const result = parseTacArgs(['-b', 'file.txt'])
      expect(result.options.before).toBe(true)
    })

    it('parses -r regex option', () => {
      const result = parseTacArgs(['-r', '-s', '\\n+', 'file.txt'])
      expect(result.options.regex).toBe(true)
      expect(result.options.separator).toBe('\\n+')
    })
  })

  describe('executeTac', () => {
    it('reverses lines in basic input', () => {
      const result = executeTac('line1\nline2\nline3\n')
      expect(result).toBe('line3\nline2\nline1\n')
    })

    it('handles input without trailing newline', () => {
      const result = executeTac('line1\nline2\nline3')
      expect(result).toBe('line3\nline2\nline1\n')
    })

    it('handles single line', () => {
      const result = executeTac('single\n')
      expect(result).toBe('single\n')
    })

    it('handles empty input', () => {
      const result = executeTac('')
      expect(result).toBe('')
    })

    it('uses custom separator', () => {
      const result = executeTac('a|b|c|', { separator: '|' })
      expect(result).toBe('c|b|a|')
    })

    it('uses regex separator', () => {
      // With regex, split by :+ pattern but join with the literal separator string
      const result = executeTac('a::b:::c::', { separator: ':+', regex: true })
      // Note: When using regex, we use the separator pattern as-is for joining
      // This matches real tac behavior where -r uses literal separator for output
      expect(result).toBe('c:+b:+a:+')
    })

    it('handles before mode', () => {
      const result = executeTac('a\nb\nc\n', { before: true })
      expect(result).toBe('\nc\nb\na')
    })
  })
})

// ============================================================================
// SHUF COMMAND TESTS
// ============================================================================

describe('shuf command', () => {
  describe('parseShufArgs', () => {
    it('parses -n count option', () => {
      const result = parseShufArgs(['-n', '5', 'file.txt'])
      expect(result.options.count).toBe(5)
      expect(result.files).toEqual(['file.txt'])
    })

    it('parses -n5 form', () => {
      const result = parseShufArgs(['-n5'])
      expect(result.options.count).toBe(5)
    })

    it('parses -i input range', () => {
      const result = parseShufArgs(['-i', '1-10'])
      expect(result.options.inputRange).toEqual({ start: 1, end: 10 })
    })

    it('parses -r replacement flag', () => {
      const result = parseShufArgs(['-r', '-n', '5'])
      expect(result.options.replacement).toBe(true)
    })

    it('parses -e echo mode with args', () => {
      const result = parseShufArgs(['-e', 'a', 'b', 'c'])
      expect(result.options.echoArgs).toEqual(['a', 'b', 'c'])
    })

    it('parses -z zero-terminated', () => {
      const result = parseShufArgs(['-z', 'file.txt'])
      expect(result.options.zeroTerminated).toBe(true)
    })
  })

  describe('executeShuf', () => {
    it('shuffles input lines', () => {
      const lines = ['a', 'b', 'c', 'd', 'e']
      const result = executeShuf(lines)

      // All lines should be present
      const outputLines = result.result.trim().split('\n')
      expect(outputLines.sort()).toEqual(lines.sort())
    })

    it('respects count option', () => {
      const lines = ['a', 'b', 'c', 'd', 'e']
      const result = executeShuf(lines, { count: 2 })

      const outputLines = result.result.trim().split('\n')
      expect(outputLines.length).toBe(2)
    })

    it('handles count of 0', () => {
      const result = executeShuf(['a', 'b', 'c'], { count: 0 })
      expect(result.result).toBe('')
    })

    it('generates input range', () => {
      const result = executeShuf([], { inputRange: { start: 1, end: 5 } })
      const outputLines = result.result.trim().split('\n').map(Number)

      expect(outputLines.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    })

    it('uses echo args', () => {
      const result = executeShuf([], { echoArgs: ['red', 'green', 'blue'] })
      const outputLines = result.result.trim().split('\n')

      expect(outputLines.sort()).toEqual(['blue', 'green', 'red'])
    })

    it('allows replacement sampling', () => {
      const result = executeShuf(['a'], { replacement: true, count: 5 })
      const outputLines = result.result.trim().split('\n')

      expect(outputLines.length).toBe(5)
      outputLines.forEach(line => expect(line).toBe('a'))
    })

    it('uses zero terminator', () => {
      const result = executeShuf(['a', 'b'], { zeroTerminated: true })
      expect(result.result).toContain('\0')
      expect(result.result).not.toContain('\n')
    })

    it('filters empty lines from input', () => {
      const result = executeShuf(['a', '', 'b', '', 'c'])
      const outputLines = result.result.trim().split('\n')
      expect(outputLines.length).toBe(3)
    })
  })
})

// ============================================================================
// COMMAND SET TESTS
// ============================================================================

describe('command set', () => {
  it('includes all extended utility commands', () => {
    expect(EXTENDED_UTILS_COMMANDS.has('env')).toBe(true)
    expect(EXTENDED_UTILS_COMMANDS.has('id')).toBe(true)
    expect(EXTENDED_UTILS_COMMANDS.has('uname')).toBe(true)
    expect(EXTENDED_UTILS_COMMANDS.has('timeout')).toBe(true)
    expect(EXTENDED_UTILS_COMMANDS.has('tac')).toBe(true)
    expect(EXTENDED_UTILS_COMMANDS.has('shuf')).toBe(true)
  })

  it('has exactly 6 commands', () => {
    expect(EXTENDED_UTILS_COMMANDS.size).toBe(6)
  })

  describe('isExtendedUtilsCommand', () => {
    it('returns true for extended utils commands', () => {
      expect(isExtendedUtilsCommand('env')).toBe(true)
      expect(isExtendedUtilsCommand('tac')).toBe(true)
    })

    it('returns false for non-extended utils commands', () => {
      expect(isExtendedUtilsCommand('cat')).toBe(false)
      expect(isExtendedUtilsCommand('ls')).toBe(false)
    })
  })
})
