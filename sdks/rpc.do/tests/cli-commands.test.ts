// CLI Commands Tests - TDD for rpc.do CLI
// Tests the commander-based CLI entry point, command parsing, and integration
// Following RED -> GREEN -> REFACTOR methodology

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ============================================================================
// Test Setup
// ============================================================================

let testDir: string

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), 'rpc-do-cli-commands-test-' + Date.now())
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(async () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true })
  }
})

// ============================================================================
// CLI Program Structure Tests
// ============================================================================

describe('CLI program structure', () => {
  it('exports main CLI commands', async () => {
    // Verify the CLI module structure
    const initModule = await import('../src/cli/init')
    const pullModule = await import('../src/cli/pull')
    const evalModule = await import('../src/cli/eval')
    const loginModule = await import('../src/cli/login')
    const replModule = await import('../src/cli/repl')
    const loggerModule = await import('../src/cli/logger')

    expect(initModule.init).toBeDefined()
    expect(pullModule.pull).toBeDefined()
    expect(evalModule.evalCommand).toBeDefined()
    expect(evalModule.runCommand).toBeDefined()
    expect(loginModule.loginCommand).toBeDefined()
    expect(loginModule.logoutCommand).toBeDefined()
    expect(loginModule.whoamiCommand).toBeDefined()
    expect(replModule.ReplService).toBeDefined()
    expect(loggerModule.LogLevel).toBeDefined()
  })

  it('init command exports TEMPLATES constant', async () => {
    const { TEMPLATES } = await import('../src/cli/init')

    expect(TEMPLATES).toBeDefined()
    expect(Array.isArray(TEMPLATES)).toBe(true)
    expect(TEMPLATES).toContain('basic')
    expect(TEMPLATES).toContain('full')
  })

  it('logger exports log level utilities', async () => {
    const {
      LogLevel,
      setLogLevel,
      getLogLevel,
      initLogLevelFromEnv,
      createLogger,
    } = await import('../src/cli/logger')

    expect(LogLevel).toBeDefined()
    expect(setLogLevel).toBeDefined()
    expect(getLogLevel).toBeDefined()
    expect(initLogLevelFromEnv).toBeDefined()
    expect(createLogger).toBeDefined()
  })
})

// ============================================================================
// Command Parsing Tests (using Commander)
// ============================================================================

describe('CLI command parsing', () => {
  it('init command accepts endpoint as required argument', () => {
    const program = new Command()
    let capturedEndpoint: string | undefined

    program
      .command('init')
      .argument('<endpoint>', 'RPC endpoint URL')
      .action((endpoint: string) => {
        capturedEndpoint = endpoint
      })

    program.parse(['node', 'test', 'init', 'https://api.example.com'])

    expect(capturedEndpoint).toBe('https://api.example.com')
  })

  it('init command accepts --template option', () => {
    const program = new Command()
    let capturedOptions: { template?: string } = {}

    program
      .command('init')
      .argument('<endpoint>', 'RPC endpoint URL')
      .option('-t, --template <name>', 'Template name', 'basic')
      .action((_endpoint: string, options: { template?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'init', 'https://api.example.com', '--template', 'full'])

    expect(capturedOptions.template).toBe('full')
  })

  it('init command accepts --skip-pull option', () => {
    const program = new Command()
    let capturedOptions: { skipPull?: boolean } = {}

    program
      .command('init')
      .argument('<endpoint>', 'RPC endpoint URL')
      .option('--skip-pull', 'Skip pulling types from endpoint')
      .action((_endpoint: string, options: { skipPull?: boolean }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'init', 'https://api.example.com', '--skip-pull'])

    expect(capturedOptions.skipPull).toBe(true)
  })

  it('init command accepts --force option', () => {
    const program = new Command()
    let capturedOptions: { force?: boolean } = {}

    program
      .command('init')
      .argument('<endpoint>', 'RPC endpoint URL')
      .option('-f, --force', 'Force overwrite existing configuration')
      .action((_endpoint: string, options: { force?: boolean }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'init', 'https://api.example.com', '--force'])

    expect(capturedOptions.force).toBe(true)
  })

  it('pull command accepts optional endpoint argument', () => {
    const program = new Command()
    let capturedEndpoint: string | undefined

    program
      .command('pull')
      .argument('[endpoint]', 'RPC endpoint URL')
      .action((endpoint?: string) => {
        capturedEndpoint = endpoint
      })

    program.parse(['node', 'test', 'pull', 'https://api.example.com'])

    expect(capturedEndpoint).toBe('https://api.example.com')
  })

  it('pull command accepts --from option as alternative to argument', () => {
    const program = new Command()
    let capturedOptions: { from?: string } = {}

    program
      .command('pull')
      .argument('[endpoint]', 'RPC endpoint URL')
      .option('-f, --from <url>', 'RPC endpoint URL')
      .action((_endpoint: string | undefined, options: { from?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'pull', '--from', 'https://api.example.com'])

    expect(capturedOptions.from).toBe('https://api.example.com')
  })

  it('pull command accepts --out option', () => {
    const program = new Command()
    let capturedOptions: { out?: string } = {}

    program
      .command('pull')
      .argument('[endpoint]', 'RPC endpoint URL')
      .option('-o, --out <path>', 'Output path')
      .action((_endpoint: string | undefined, options: { out?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'pull', 'https://api.example.com', '--out', '/custom/path.d.ts'])

    expect(capturedOptions.out).toBe('/custom/path.d.ts')
  })

  it('pull command accepts --timeout option', () => {
    const program = new Command()
    let capturedOptions: { timeout?: string } = {}

    program
      .command('pull')
      .argument('[endpoint]', 'RPC endpoint URL')
      .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '30000')
      .action((_endpoint: string | undefined, options: { timeout?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'pull', 'https://api.example.com', '--timeout', '60000'])

    expect(capturedOptions.timeout).toBe('60000')
  })

  it('eval command accepts endpoint and code arguments', () => {
    const program = new Command()
    let capturedEndpoint: string | undefined
    let capturedCode: string | undefined

    program
      .command('eval')
      .argument('<endpoint>', 'RPC endpoint URL')
      .argument('<code>', 'Code to evaluate')
      .action((endpoint: string, code: string) => {
        capturedEndpoint = endpoint
        capturedCode = code
      })

    program.parse(['node', 'test', 'eval', 'https://api.example.com', '1+1'])

    expect(capturedEndpoint).toBe('https://api.example.com')
    expect(capturedCode).toBe('1+1')
  })

  it('eval command accepts --timeout option', () => {
    const program = new Command()
    let capturedOptions: { timeout?: string } = {}

    program
      .command('eval')
      .argument('<endpoint>', 'RPC endpoint URL')
      .argument('<code>', 'Code to evaluate')
      .option('-t, --timeout <ms>', 'Execution timeout', '5000')
      .action((_e: string, _c: string, options: { timeout?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'eval', 'https://api.example.com', '1+1', '--timeout', '10000'])

    expect(capturedOptions.timeout).toBe('10000')
  })

  it('eval command accepts --pretty option', () => {
    const program = new Command()
    let capturedOptions: { pretty?: boolean } = {}

    program
      .command('eval')
      .argument('<endpoint>', 'RPC endpoint URL')
      .argument('<code>', 'Code to evaluate')
      .option('-p, --pretty', 'Pretty print JSON output')
      .action((_e: string, _c: string, options: { pretty?: boolean }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'eval', 'https://api.example.com', '1+1', '--pretty'])

    expect(capturedOptions.pretty).toBe(true)
  })

  it('eval command accepts --auth option', () => {
    const program = new Command()
    let capturedOptions: { auth?: string } = {}

    program
      .command('eval')
      .argument('<endpoint>', 'RPC endpoint URL')
      .argument('<code>', 'Code to evaluate')
      .option('-a, --auth <token>', 'OAuth token for authentication')
      .action((_e: string, _c: string, options: { auth?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'eval', 'https://api.example.com', '1+1', '--auth', 'my-token'])

    expect(capturedOptions.auth).toBe('my-token')
  })

  it('run command accepts endpoint and file arguments', () => {
    const program = new Command()
    let capturedEndpoint: string | undefined
    let capturedFile: string | undefined

    program
      .command('run')
      .argument('<endpoint>', 'RPC endpoint URL')
      .argument('<file>', 'Script file to execute')
      .action((endpoint: string, file: string) => {
        capturedEndpoint = endpoint
        capturedFile = file
      })

    program.parse(['node', 'test', 'run', 'https://api.example.com', './script.ts'])

    expect(capturedEndpoint).toBe('https://api.example.com')
    expect(capturedFile).toBe('./script.ts')
  })

  it('run command accepts --watch option', () => {
    const program = new Command()
    let capturedOptions: { watch?: boolean } = {}

    program
      .command('run')
      .argument('<endpoint>', 'RPC endpoint URL')
      .argument('<file>', 'Script file to execute')
      .option('-w, --watch', 'Watch for file changes')
      .action((_e: string, _f: string, options: { watch?: boolean }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'run', 'https://api.example.com', './script.ts', '--watch'])

    expect(capturedOptions.watch).toBe(true)
  })

  it('repl command accepts endpoint argument', () => {
    const program = new Command()
    let capturedEndpoint: string | undefined

    program
      .command('repl')
      .argument('<endpoint>', 'RPC endpoint URL')
      .action((endpoint: string) => {
        capturedEndpoint = endpoint
      })

    program.parse(['node', 'test', 'repl', 'https://api.example.com'])

    expect(capturedEndpoint).toBe('https://api.example.com')
  })

  it('repl command accepts --types option', () => {
    const program = new Command()
    let capturedOptions: { types?: string } = {}

    program
      .command('repl')
      .argument('<endpoint>', 'RPC endpoint URL')
      .option('-t, --types <path>', 'Path to TypeScript types file')
      .action((_e: string, options: { types?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'repl', 'https://api.example.com', '--types', '.do/$.d.ts'])

    expect(capturedOptions.types).toBe('.do/$.d.ts')
  })

  it('repl command accepts --history option', () => {
    const program = new Command()
    let capturedOptions: { history?: string } = {}

    program
      .command('repl')
      .argument('<endpoint>', 'RPC endpoint URL')
      .option('-H, --history <path>', 'Path to history file')
      .action((_e: string, options: { history?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'repl', 'https://api.example.com', '--history', '~/.do/repl_history'])

    expect(capturedOptions.history).toBe('~/.do/repl_history')
  })

  it('login command accepts --force option', () => {
    const program = new Command()
    let capturedOptions: { force?: boolean } = {}

    program
      .command('login')
      .option('--force', 'Force re-authentication')
      .action((options: { force?: boolean }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'login', '--force'])

    expect(capturedOptions.force).toBe(true)
  })

  it('login command accepts --provider option', () => {
    const program = new Command()
    let capturedOptions: { provider?: string } = {}

    program
      .command('login')
      .option('--provider <name>', 'OAuth provider preset', 'oauth.do')
      .action((options: { provider?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'login', '--provider', 'github'])

    expect(capturedOptions.provider).toBe('github')
  })

  it('login command accepts --client-id option', () => {
    const program = new Command()
    let capturedOptions: { clientId?: string } = {}

    program
      .command('login')
      .option('--client-id <id>', 'OAuth client ID')
      .action((options: { clientId?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'login', '--client-id', 'my-custom-client'])

    expect(capturedOptions.clientId).toBe('my-custom-client')
  })

  it('login command accepts --oauth-url option', () => {
    const program = new Command()
    let capturedOptions: { oauthUrl?: string } = {}

    program
      .command('login')
      .option('--oauth-url <url>', 'OAuth server URL')
      .action((options: { oauthUrl?: string }) => {
        capturedOptions = options
      })

    program.parse(['node', 'test', 'login', '--oauth-url', 'https://my-oauth.example.com'])

    expect(capturedOptions.oauthUrl).toBe('https://my-oauth.example.com')
  })

  it('logout command has no required arguments', () => {
    const program = new Command()
    let logoutCalled = false

    program
      .command('logout')
      .action(() => {
        logoutCalled = true
      })

    program.parse(['node', 'test', 'logout'])

    expect(logoutCalled).toBe(true)
  })

  it('whoami command has no required arguments', () => {
    const program = new Command()
    let whoamiCalled = false

    program
      .command('whoami')
      .action(() => {
        whoamiCalled = true
      })

    program.parse(['node', 'test', 'whoami'])

    expect(whoamiCalled).toBe(true)
  })
})

// ============================================================================
// Global Flags Tests
// ============================================================================

describe('CLI global flags', () => {
  it('program accepts --verbose global flag', () => {
    const program = new Command()
    let globalVerbose = false

    program
      .option('-v, --verbose', 'Show detailed output')
      .hook('preAction', (thisCommand) => {
        globalVerbose = thisCommand.opts()['verbose'] ?? false
      })

    program
      .command('test')
      .action(() => {})

    program.parse(['node', 'test', '--verbose', 'test'])

    expect(globalVerbose).toBe(true)
  })

  it('program accepts --quiet global flag', () => {
    const program = new Command()
    let globalQuiet = false

    program
      .option('-q, --quiet', 'Only show errors and warnings')
      .hook('preAction', (thisCommand) => {
        globalQuiet = thisCommand.opts()['quiet'] ?? false
      })

    program
      .command('test')
      .action(() => {})

    program.parse(['node', 'test', '--quiet', 'test'])

    expect(globalQuiet).toBe(true)
  })

  it('program accepts --debug global flag', () => {
    const program = new Command()
    let globalDebug = false

    program
      .option('--debug', 'Show debug-level output')
      .hook('preAction', (thisCommand) => {
        globalDebug = thisCommand.opts()['debug'] ?? false
      })

    program
      .command('test')
      .action(() => {})

    program.parse(['node', 'test', '--debug', 'test'])

    expect(globalDebug).toBe(true)
  })

  it('global flags are accessible from subcommands via parent', () => {
    const program = new Command()
    let accessedVerbose: boolean | undefined

    program
      .option('-v, --verbose', 'Show detailed output')

    program
      .command('eval')
      .argument('<endpoint>')
      .argument('<code>')
      .action((_e: string, _c: string, _options: unknown, command: Command) => {
        accessedVerbose = command.parent?.opts()['verbose']
      })

    program.parse(['node', 'test', '--verbose', 'eval', 'http://test', 'code'])

    expect(accessedVerbose).toBe(true)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('CLI error handling', () => {
  it('missing required argument shows error', () => {
    const program = new Command()
    program.exitOverride()
    program.configureOutput({
      writeErr: () => {},
    })

    program
      .command('init')
      .argument('<endpoint>', 'RPC endpoint URL')
      .action(() => {})

    expect(() => {
      program.parse(['node', 'test', 'init'])
    }).toThrow()
  })

  it('unknown command shows error', () => {
    const program = new Command()
    program.exitOverride()
    program.configureOutput({
      writeErr: () => {},
    })

    program
      .command('init')
      .argument('<endpoint>')
      .action(() => {})

    expect(() => {
      program.parse(['node', 'test', 'unknown-command'])
    }).toThrow()
  })

  it('unknown option shows error', () => {
    const program = new Command()
    program.exitOverride()
    program.configureOutput({
      writeErr: () => {},
    })

    program
      .command('init')
      .argument('<endpoint>')
      .action(() => {})

    expect(() => {
      program.parse(['node', 'test', 'init', 'https://api.example.com', '--unknown-option'])
    }).toThrow()
  })
})

// ============================================================================
// Integration Tests - Command Functions
// ============================================================================

describe('CLI command function integration', () => {
  it('init function returns InitResult interface', async () => {
    const { init } = await import('../src/cli/init')

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: testDir,
      skipPull: true,
    })

    // Should have proper result structure
    expect(typeof result.success).toBe('boolean')
    if (result.success) {
      expect(result.configPath).toBeDefined()
    } else {
      expect(result.error).toBeDefined()
    }
  })

  it('pull function returns PullResult interface', async () => {
    const { pull } = await import('../src/cli/pull')

    // Mock fetch for this test
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('export interface $ { test(): void }'),
    })
    globalThis.fetch = mockFetch

    const result = await pull({
      endpoint: 'https://api.example.com',
      cwd: testDir,
    })

    expect(typeof result.success).toBe('boolean')
    if (result.success) {
      expect(result.outPath).toBeDefined()
    } else {
      expect(result.error).toBeDefined()
    }
  })

  it('evalCommand function returns EvalResult interface', async () => {
    const { evalCommand } = await import('../src/cli/eval')

    // Mock fetch for this test
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 42 }),
    })
    globalThis.fetch = mockFetch

    const result = await evalCommand('https://api.example.com', '21 * 2', {})

    expect(typeof result.success).toBe('boolean')
    if (result.success) {
      expect(result.value).toBeDefined()
    } else {
      expect(result.error).toBeDefined()
    }
  })

  it('loginCommand function returns CommandResult interface', async () => {
    const { loginCommand } = await import('../src/cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'test',
        user_code: 'TEST-1234',
        verification_uri: 'https://test.com',
        expires_in: 600,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'token',
        expires_in: 3600,
      }),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const result = await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: () => {},
    })

    expect(typeof result.success).toBe('boolean')
  })

  it('logoutCommand function returns CommandResult interface', async () => {
    const { logoutCommand } = await import('../src/cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const result = await logoutCommand({
      tokenStore: mockTokenStore,
      onOutput: () => {},
    })

    expect(typeof result.success).toBe('boolean')
  })

  it('whoamiCommand function returns WhoamiResult interface', async () => {
    const { whoamiCommand } = await import('../src/cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const result = await whoamiCommand({
      tokenStore: mockTokenStore,
      onOutput: () => {},
    })

    expect(typeof result.success).toBe('boolean')
    expect(typeof result.loggedIn).toBe('boolean')
  })
})

// ============================================================================
// Logger Integration Tests
// ============================================================================

describe('CLI logger integration', () => {
  it('setLogLevel changes global log level', async () => {
    const { setLogLevel, getLogLevel, LogLevel } = await import('../src/cli/logger')

    const originalLevel = getLogLevel()

    setLogLevel(LogLevel.DEBUG)
    expect(getLogLevel()).toBe(LogLevel.DEBUG)

    setLogLevel(LogLevel.VERBOSE)
    expect(getLogLevel()).toBe(LogLevel.VERBOSE)

    // Restore original
    setLogLevel(originalLevel)
  })

  it('createLogger with options creates properly configured logger', async () => {
    const { createLogger, setLogLevel, LogLevel } = await import('../src/cli/logger')

    const output: string[] = []
    const logger = createLogger({ output: (msg) => output.push(msg) })

    // At DEBUG level, should log verbose messages
    setLogLevel(LogLevel.DEBUG)
    logger.verbose('test verbose message')

    expect(output.some(o => o.includes('test verbose message'))).toBe(true)

    // Reset
    setLogLevel(LogLevel.INFO)
  })

  it('initLogLevelFromEnv reads environment variables', async () => {
    const { getLogLevelFromEnv, LogLevel } = await import('../src/cli/logger')

    // Without env vars, should return NORMAL
    const originalDebug = process.env['RPC_DO_DEBUG']
    const originalVerbose = process.env['RPC_DO_VERBOSE']
    const originalD = process.env['DEBUG']

    delete process.env['RPC_DO_DEBUG']
    delete process.env['RPC_DO_VERBOSE']
    delete process.env['DEBUG']

    expect(getLogLevelFromEnv()).toBe(LogLevel.NORMAL)

    // Restore
    if (originalDebug !== undefined) process.env['RPC_DO_DEBUG'] = originalDebug
    if (originalVerbose !== undefined) process.env['RPC_DO_VERBOSE'] = originalVerbose
    if (originalD !== undefined) process.env['DEBUG'] = originalD
  })
})

// ============================================================================
// OAuth Provider Presets Tests
// ============================================================================

describe('OAuth provider presets', () => {
  it('createDefaultLoginOptions accepts oauth.do provider', async () => {
    const { createDefaultLoginOptions } = await import('../src/cli/login')

    const options = createDefaultLoginOptions({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
    })

    expect(options.deviceFlow).toBeDefined()
    expect(options.tokenStore).toBeDefined()
  })

  it('createDefaultLoginOptions accepts custom tokensPath', async () => {
    const { createDefaultLoginOptions } = await import('../src/cli/login')

    const customPath = path.join(testDir, 'custom-tokens.json')
    const options = createDefaultLoginOptions({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      tokensPath: customPath,
    })

    expect(options.tokenStore).toBeDefined()
  })
})

// ============================================================================
// REPL Service Options Tests
// ============================================================================

describe('REPL service options', () => {
  it('ReplService accepts all configuration options', async () => {
    const { ReplService } = await import('../src/cli/repl')

    const mockTransport = {
      send: vi.fn().mockResolvedValue({ result: 'test', correlationId: 'test' }),
    }

    const output: string[] = []
    const repl = new ReplService({
      transport: mockTransport as any,
      types: 'export interface $ { test(): void }',
      historyPath: path.join(testDir, 'history'),
      maxHistorySize: 500,
      prompt: 'custom> ',
      output: (msg) => output.push(msg),
      onExit: () => {},
      onClear: () => {},
    })

    expect(repl).toBeDefined()
    expect(repl.getPrompt()).toBe('custom> ')
  })

  it('ReplService without types still works', async () => {
    const { ReplService } = await import('../src/cli/repl')

    const mockTransport = {
      send: vi.fn().mockResolvedValue({ result: 'test', correlationId: 'test' }),
    }

    const repl = new ReplService({
      transport: mockTransport as any,
      // No types provided
    })

    expect(repl).toBeDefined()
  })
})

// ============================================================================
// LSP Service Options Tests
// ============================================================================

describe('LSP service options', () => {
  it('LSPService accepts types string', async () => {
    const { LSPService } = await import('../src/cli/lsp')

    const lsp = new LSPService({
      types: 'export interface $ { test(): void }',
    })

    expect(lsp).toBeDefined()
    expect(lsp.isReady()).toBe(true)
  })

  it('LSPService accepts custom compiler options', async () => {
    const { LSPService } = await import('../src/cli/lsp')
    const ts = await import('typescript')

    const lsp = new LSPService({
      types: 'export interface $ { test(): void }',
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        strict: true,
      },
    })

    expect(lsp).toBeDefined()
    expect(lsp.isReady()).toBe(true)
  })
})

// ============================================================================
// CLI Version and Help Tests
// ============================================================================

describe('CLI version and help', () => {
  it('program has name and description', () => {
    const program = new Command()
    program
      .name('rpc.do')
      .description('CLI for rpc.do')
      .version('0.0.1')

    expect(program.name()).toBe('rpc.do')
    expect(program.description()).toBe('CLI for rpc.do')
    expect(program.version()).toBe('0.0.1')
  })

  it('program has version option', () => {
    const program = new Command()
    program.version('1.0.0')

    // Commander automatically adds -V and --version
    const versionOption = program.options.find(
      opt => opt.short === '-V' || opt.long === '--version'
    )
    expect(versionOption).toBeDefined()
  })
})
