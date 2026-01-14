import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createCLI, runCLI, parseArgs, CLIOptions, CLIResult } from '../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Capture stdout/stderr output during CLI execution
 */
function createOutputCapture() {
  const output: { stdout: string[]; stderr: string[] } = {
    stdout: [],
    stderr: []
  }

  return {
    output,
    stdout: (msg: string) => output.stdout.push(msg),
    stderr: (msg: string) => output.stderr.push(msg)
  }
}

/**
 * Run CLI with arguments and capture output
 */
async function runCLIWithCapture(args: string[]): Promise<{
  result: CLIResult
  stdout: string[]
  stderr: string[]
}> {
  const capture = createOutputCapture()
  const result = await runCLI(args, {
    stdout: capture.stdout,
    stderr: capture.stderr
  })
  return {
    result,
    stdout: capture.output.stdout,
    stderr: capture.output.stderr
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CLI Entry Point', () => {
  describe('Help Flag', () => {
    describe('Displaying help with --help', () => {
      it('should show help message when --help flag is provided', async () => {
        const { result, stdout } = await runCLIWithCapture(['--help'])

        expect(result.exitCode).toBe(0)
        expect(stdout.join('\n')).toContain('gitx')
        expect(stdout.join('\n')).toContain('Usage')
      })

      it('should show help message when -h flag is provided', async () => {
        const { result, stdout } = await runCLIWithCapture(['-h'])

        expect(result.exitCode).toBe(0)
        expect(stdout.join('\n')).toContain('gitx')
      })

      it('should list available subcommands in help output', async () => {
        const { stdout } = await runCLIWithCapture(['--help'])

        const output = stdout.join('\n')
        expect(output).toContain('status')
        expect(output).toContain('diff')
        expect(output).toContain('log')
        expect(output).toContain('blame')
        expect(output).toContain('commit')
        expect(output).toContain('branch')
        expect(output).toContain('review')
        expect(output).toContain('web')
      })

      it('should show help for specific subcommand', async () => {
        const { result, stdout } = await runCLIWithCapture(['status', '--help'])

        expect(result.exitCode).toBe(0)
        expect(stdout.join('\n')).toContain('status')
      })
    })
  })

  describe('Version Flag', () => {
    describe('Displaying version with --version', () => {
      it('should show version when --version flag is provided', async () => {
        const { result, stdout } = await runCLIWithCapture(['--version'])

        expect(result.exitCode).toBe(0)
        expect(stdout.join('\n')).toMatch(/\d+\.\d+\.\d+/)
      })

      it('should show version when -v flag is provided', async () => {
        const { result, stdout } = await runCLIWithCapture(['-v'])

        expect(result.exitCode).toBe(0)
        expect(stdout.join('\n')).toMatch(/\d+\.\d+\.\d+/)
      })

      it('should show package name with version', async () => {
        const { stdout } = await runCLIWithCapture(['--version'])

        expect(stdout.join('\n')).toContain('gitx')
      })
    })
  })

  describe('Subcommand Parsing', () => {
    describe('Parsing status subcommand', () => {
      it('should parse status command', async () => {
        const parsed = parseArgs(['status'])

        expect(parsed.command).toBe('status')
      })

      it('should parse status with options', async () => {
        const parsed = parseArgs(['status', '--short'])

        expect(parsed.command).toBe('status')
        expect(parsed.options.short).toBe(true)
      })

      it('should parse status with branch option', async () => {
        const parsed = parseArgs(['status', '--branch'])

        expect(parsed.command).toBe('status')
        expect(parsed.options.branch).toBe(true)
      })
    })

    describe('Parsing diff subcommand', () => {
      it('should parse diff command', async () => {
        const parsed = parseArgs(['diff'])

        expect(parsed.command).toBe('diff')
      })

      it('should parse diff with commit refs', async () => {
        const parsed = parseArgs(['diff', 'HEAD~1', 'HEAD'])

        expect(parsed.command).toBe('diff')
        expect(parsed.args).toContain('HEAD~1')
        expect(parsed.args).toContain('HEAD')
      })

      it('should parse diff with --staged option', async () => {
        const parsed = parseArgs(['diff', '--staged'])

        expect(parsed.command).toBe('diff')
        expect(parsed.options.staged).toBe(true)
      })

      it('should parse diff with --cached option (alias for staged)', async () => {
        const parsed = parseArgs(['diff', '--cached'])

        expect(parsed.command).toBe('diff')
        expect(parsed.options.cached).toBe(true)
      })
    })

    describe('Parsing log subcommand', () => {
      it('should parse log command', async () => {
        const parsed = parseArgs(['log'])

        expect(parsed.command).toBe('log')
      })

      it('should parse log with -n option', async () => {
        const parsed = parseArgs(['log', '-n', '10'])

        expect(parsed.command).toBe('log')
        expect(parsed.options.n).toBe(10)
      })

      it('should parse log with --oneline option', async () => {
        const parsed = parseArgs(['log', '--oneline'])

        expect(parsed.command).toBe('log')
        expect(parsed.options.oneline).toBe(true)
      })

      it('should parse log with --graph option', async () => {
        const parsed = parseArgs(['log', '--graph'])

        expect(parsed.command).toBe('log')
        expect(parsed.options.graph).toBe(true)
      })

      it('should parse log with --all option', async () => {
        const parsed = parseArgs(['log', '--all'])

        expect(parsed.command).toBe('log')
        expect(parsed.options.all).toBe(true)
      })
    })

    describe('Parsing blame subcommand', () => {
      it('should parse blame command', async () => {
        const parsed = parseArgs(['blame', 'file.ts'])

        expect(parsed.command).toBe('blame')
        expect(parsed.args).toContain('file.ts')
      })

      it('should parse blame with line range', async () => {
        const parsed = parseArgs(['blame', '-L', '10,20', 'file.ts'])

        expect(parsed.command).toBe('blame')
        expect(parsed.options.L).toBe('10,20')
      })
    })

    describe('Parsing commit subcommand', () => {
      it('should parse commit command', async () => {
        const parsed = parseArgs(['commit'])

        expect(parsed.command).toBe('commit')
      })

      it('should parse commit with message', async () => {
        const parsed = parseArgs(['commit', '-m', 'Initial commit'])

        expect(parsed.command).toBe('commit')
        expect(parsed.options.m).toBe('Initial commit')
      })

      it('should parse commit with --amend option', async () => {
        const parsed = parseArgs(['commit', '--amend'])

        expect(parsed.command).toBe('commit')
        expect(parsed.options.amend).toBe(true)
      })

      it('should parse commit with --all option', async () => {
        const parsed = parseArgs(['commit', '-a'])

        expect(parsed.command).toBe('commit')
        expect(parsed.options.a).toBe(true)
      })
    })

    describe('Parsing branch subcommand', () => {
      it('should parse branch command', async () => {
        const parsed = parseArgs(['branch'])

        expect(parsed.command).toBe('branch')
      })

      it('should parse branch with name', async () => {
        const parsed = parseArgs(['branch', 'feature/new'])

        expect(parsed.command).toBe('branch')
        expect(parsed.args).toContain('feature/new')
      })

      it('should parse branch with --delete option', async () => {
        const parsed = parseArgs(['branch', '-d', 'feature/old'])

        expect(parsed.command).toBe('branch')
        expect(parsed.options.d).toBe(true)
      })

      it('should parse branch with --list option', async () => {
        const parsed = parseArgs(['branch', '--list'])

        expect(parsed.command).toBe('branch')
        expect(parsed.options.list).toBe(true)
      })
    })

    describe('Parsing review subcommand', () => {
      it('should parse review command', async () => {
        const parsed = parseArgs(['review'])

        expect(parsed.command).toBe('review')
      })

      it('should parse review with PR number', async () => {
        const parsed = parseArgs(['review', '123'])

        expect(parsed.command).toBe('review')
        expect(parsed.args).toContain('123')
      })

      it('should parse review with --interactive option', async () => {
        const parsed = parseArgs(['review', '--interactive'])

        expect(parsed.command).toBe('review')
        expect(parsed.options.interactive).toBe(true)
      })
    })

    describe('Parsing web subcommand', () => {
      it('should parse web command', async () => {
        const parsed = parseArgs(['web'])

        expect(parsed.command).toBe('web')
      })

      it('should parse web with --port option', async () => {
        const parsed = parseArgs(['web', '--port', '3000'])

        expect(parsed.command).toBe('web')
        expect(parsed.options.port).toBe(3000)
      })

      it('should parse web with --open option', async () => {
        const parsed = parseArgs(['web', '--open'])

        expect(parsed.command).toBe('web')
        expect(parsed.options.open).toBe(true)
      })
    })
  })

  describe('Unknown Command Handling', () => {
    describe('Handling unknown commands gracefully', () => {
      it('should return error for unknown command', async () => {
        const { result, stderr } = await runCLIWithCapture(['unknown-command'])

        expect(result.exitCode).toBe(1)
        expect(stderr.join('\n')).toContain('unknown-command')
      })

      it('should suggest similar command if typo detected', async () => {
        const { stderr } = await runCLIWithCapture(['statu'])

        expect(stderr.join('\n')).toMatch(/did you mean.*status/i)
      })

      it('should show help hint for unknown command', async () => {
        const { stderr } = await runCLIWithCapture(['foobar'])

        expect(stderr.join('\n')).toContain('--help')
      })

      it('should handle completely invalid input', async () => {
        const { result } = await runCLIWithCapture(['--invalid-flag'])

        expect(result.exitCode).toBe(1)
      })
    })
  })

  describe('Working Directory', () => {
    describe('Reading from current working directory by default', () => {
      it('should use process.cwd() by default', async () => {
        const parsed = parseArgs(['status'])

        expect(parsed.cwd).toBe(process.cwd())
      })

      it('should pass cwd to command handlers', async () => {
        const cli = createCLI()
        const mockHandler = vi.fn()
        cli.registerCommand('status', mockHandler)

        await cli.run(['status'])

        expect(mockHandler).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: process.cwd() })
        )
      })
    })

    describe('Accepting --cwd flag to specify directory', () => {
      it('should accept --cwd flag', async () => {
        const parsed = parseArgs(['--cwd', '/custom/path', 'status'])

        expect(parsed.cwd).toBe('/custom/path')
      })

      it('should accept -C flag as alias for --cwd', async () => {
        const parsed = parseArgs(['-C', '/custom/path', 'status'])

        expect(parsed.cwd).toBe('/custom/path')
      })

      it('should pass custom cwd to command handlers', async () => {
        const cli = createCLI()
        const mockHandler = vi.fn()
        cli.registerCommand('status', mockHandler)

        await cli.run(['--cwd', '/custom/path', 'status'])

        expect(mockHandler).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: '/custom/path' })
        )
      })

      it('should error if --cwd directory does not exist', async () => {
        const { result, stderr } = await runCLIWithCapture([
          '--cwd',
          '/nonexistent/path/12345',
          'status'
        ])

        expect(result.exitCode).toBe(1)
        expect(stderr.join('\n')).toContain('directory')
      })

      it('should resolve relative paths for --cwd', async () => {
        const parsed = parseArgs(['--cwd', './subdir', 'status'])

        expect(parsed.cwd).toMatch(/\/subdir$/)
      })
    })
  })

  describe('CLI Creation and Configuration', () => {
    describe('Creating CLI instance', () => {
      it('should create a CLI instance', () => {
        const cli = createCLI()

        expect(cli).toBeDefined()
        expect(typeof cli.run).toBe('function')
      })

      it('should allow registering custom commands', () => {
        const cli = createCLI()

        expect(typeof cli.registerCommand).toBe('function')
      })

      it('should allow setting custom version', () => {
        const cli = createCLI({ version: '1.2.3' })

        expect(cli.version).toBe('1.2.3')
      })

      it('should allow setting custom name', () => {
        const cli = createCLI({ name: 'custom-cli' })

        expect(cli.name).toBe('custom-cli')
      })
    })

    describe('CLI result structure', () => {
      it('should return exit code', async () => {
        const result = await runCLI(['--help'])

        expect(typeof result.exitCode).toBe('number')
      })

      it('should return command that was run', async () => {
        const result = await runCLI(['status'])

        expect(result.command).toBe('status')
      })

      it('should return error if command failed', async () => {
        const result = await runCLI(['unknown'])

        expect(result.error).toBeDefined()
      })
    })
  })

  describe('Argument Parsing Edge Cases', () => {
    describe('Parsing complex argument combinations', () => {
      it('should handle multiple flags', async () => {
        const parsed = parseArgs(['log', '--oneline', '--graph', '--all'])

        expect(parsed.options.oneline).toBe(true)
        expect(parsed.options.graph).toBe(true)
        expect(parsed.options.all).toBe(true)
      })

      it('should handle combined short flags', async () => {
        const parsed = parseArgs(['commit', '-am', 'Quick fix'])

        expect(parsed.options.a).toBe(true)
        expect(parsed.options.m).toBe('Quick fix')
      })

      it('should handle -- separator for raw args', async () => {
        const parsed = parseArgs(['diff', '--', 'file1.ts', 'file2.ts'])

        expect(parsed.rawArgs).toContain('file1.ts')
        expect(parsed.rawArgs).toContain('file2.ts')
      })

      it('should handle equals sign in option value', async () => {
        const parsed = parseArgs(['log', '--format=%H %s'])

        expect(parsed.options.format).toBe('%H %s')
      })

      it('should preserve order of positional arguments', async () => {
        const parsed = parseArgs(['diff', 'HEAD~2', 'HEAD~1', 'HEAD'])

        expect(parsed.args[0]).toBe('HEAD~2')
        expect(parsed.args[1]).toBe('HEAD~1')
        expect(parsed.args[2]).toBe('HEAD')
      })
    })

    describe('Empty and minimal input', () => {
      it('should handle empty args array', async () => {
        const { result, stdout } = await runCLIWithCapture([])

        // Should show help or usage when no args
        expect(result.exitCode).toBe(0)
        expect(stdout.join('\n')).toContain('Usage')
      })

      it('should handle only global options without command', async () => {
        const parsed = parseArgs(['--cwd', '/some/path'])

        expect(parsed.command).toBeUndefined()
        expect(parsed.cwd).toBe('/some/path')
      })
    })
  })
})

describe('CLI Module Exports', () => {
  it('should export createCLI function', async () => {
    const module = await import('../../src/cli/index')
    expect(typeof module.createCLI).toBe('function')
  })

  it('should export runCLI function', async () => {
    const module = await import('../../src/cli/index')
    expect(typeof module.runCLI).toBe('function')
  })

  it('should export parseArgs function', async () => {
    const module = await import('../../src/cli/index')
    expect(typeof module.parseArgs).toBe('function')
  })

  it('should export CLIOptions type', async () => {
    // Type check - this verifies the export exists at compile time
    const opts: CLIOptions = { cwd: '/test' }
    expect(opts.cwd).toBe('/test')
  })

  it('should export CLIResult type', async () => {
    // Type check - this verifies the export exists at compile time
    const result: CLIResult = { exitCode: 0, command: 'test' }
    expect(result.exitCode).toBe(0)
  })
})
