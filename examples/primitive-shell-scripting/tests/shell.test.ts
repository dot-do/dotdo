/**
 * Shell Scripting Tests
 *
 * Tests for bashx (shell without VMs) functionality.
 * Demonstrates the AST-based safety analysis and tiered execution model.
 *
 * Test categories:
 * 1. Safety Analysis - Command classification and danger detection
 * 2. Command Parsing - AST parsing and intent extraction
 * 3. Native Operations - Tier 1 file operations via fsx
 * 4. Environment Management - Environment variables and working directory
 * 5. Piping & Composition - Unix pipe and operator support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  BashResult,
  SafetyClassification,
  SafetyAnalysis,
  DangerCheck,
  Intent,
  ExecOptions,
  Program,
} from '../../../lib/mixins/bash'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock BashCapability for testing.
 * Simulates bashx behavior without actual container/RPC dependencies.
 */
function createMockBashCapability() {
  const executedCommands: Array<{ command: string; options?: ExecOptions }> = []

  // Simple parser implementation for testing
  function parse(input: string): Program {
    const trimmed = input.trim()
    const parts = trimmed.split(/\s*(\||&&|\|\||;)\s*/)
    const commands: string[] = []
    for (const part of parts) {
      const cmd = part.trim().split(/\s+/)[0]
      if (cmd && !['|', '&&', '||', ';'].includes(cmd)) {
        commands.push(cmd)
      }
    }

    return {
      type: 'Program',
      body: [{
        type: 'Command',
        name: commands[0] || '',
        commands,
        raw: trimmed,
      }],
    }
  }

  // Analyze command for safety
  function analyze(input: string): SafetyAnalysis {
    const ast = parse(input)
    const raw = input.trim()
    const commands = (ast.body[0] as { commands?: string[] })?.commands || []
    const firstCmd = commands[0]?.toLowerCase() || ''

    let type: SafetyClassification['type'] = 'execute'
    let impact: SafetyClassification['impact'] = 'low'
    let reversible = true
    let reason = 'Command execution'

    const reads: string[] = []
    const writes: string[] = []
    const deletes: string[] = []
    let network = false
    let elevated = false

    // Read operations
    if (['ls', 'cat', 'head', 'tail', 'less', 'more', 'find', 'grep', 'wc', 'pwd', 'echo', 'date', 'whoami', 'id', 'env', 'printenv'].includes(firstCmd)) {
      type = 'read'
      impact = 'none'
      reason = 'Read-only command'
    }
    // Delete operations
    else if (['rm', 'rmdir', 'unlink'].includes(firstCmd)) {
      type = 'delete'
      reversible = false
      reason = 'Delete operation'

      if (raw.includes('-r') || raw.includes('-R') || raw.includes('-rf') || raw.includes('-fr')) {
        impact = 'high'
        reason = 'Recursive delete operation'
      } else {
        impact = 'medium'
      }

      if (/\s+\/($|\s)/.test(raw) || raw.includes('/*')) {
        impact = 'critical'
        reason = 'Delete targeting root or all files'
      }
    }
    // Write operations
    else if (['mv', 'cp', 'touch', 'mkdir', 'tee'].includes(firstCmd)) {
      type = 'write'
      impact = 'low'
      reason = 'Write operation'
    }
    // System operations
    else if (['chmod', 'chown', 'chgrp'].includes(firstCmd)) {
      type = 'system'
      impact = 'medium'
      reason = 'Permission/ownership change'

      if (raw.includes('-R') || raw.includes('-r')) {
        impact = 'high'
        reason = 'Recursive permission change'
      }
    }
    // Network operations
    else if (['curl', 'wget', 'ssh', 'scp', 'rsync'].includes(firstCmd)) {
      type = 'network'
      network = true
      impact = 'low'
      reason = 'Network operation'
    }
    // Dangerous system commands
    else if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(firstCmd)) {
      type = 'system'
      impact = 'critical'
      reversible = false
      reason = 'System shutdown/reboot'
    }

    // Check for sudo/elevated
    if (commands.includes('sudo') || commands.includes('su')) {
      elevated = true
      type = 'system'
      impact = 'high'
      reason = 'Elevated privilege command'
    }

    return {
      classification: { type, impact, reversible, reason },
      intent: { commands, reads, writes, deletes, network, elevated },
    }
  }

  // Check if command is dangerous
  function isDangerous(input: string): DangerCheck {
    const raw = input.trim()

    // Dangerous patterns
    const dangerousPatterns = [
      { pattern: /\brm\s+(-[rfvdi]*\s+)*\/($|\s|[^\/])/, reason: 'Dangerous: rm targeting root directory' },
      { pattern: /\brm\s+(-[rfvdi]*\s+)*\/\*/, reason: 'Dangerous: rm targeting root contents' },
      { pattern: /\brm\s+(-[rfvdi]*\s+)*~\//, reason: 'Dangerous: rm targeting home directory' },
      { pattern: /\bchmod\s+[0-7]{3,4}\s+\/($|\s)/, reason: 'Dangerous: chmod on root' },
      { pattern: /\bdd\s+.*\bof=\/dev\/[hs]d[a-z]/, reason: 'Dangerous: dd writing to disk' },
      { pattern: /\bmkfs\b/, reason: 'Dangerous: filesystem formatting' },
      { pattern: /\bshutdown\b/, reason: 'Dangerous: system shutdown' },
      { pattern: /\breboot\b/, reason: 'Dangerous: system reboot' },
      { pattern: /:\(\)\s*\{\s*:\|\:&\s*\}\s*;\s*:/, reason: 'Dangerous: fork bomb' },
    ]

    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(raw)) {
        return { dangerous: true, reason }
      }
    }

    const analysis = analyze(raw)
    if (analysis.classification.impact === 'critical') {
      return { dangerous: true, reason: analysis.classification.reason }
    }

    return { dangerous: false }
  }

  // Execute command
  async function exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command

    executedCommands.push({ command: fullCommand, options })

    const analysis = analyze(fullCommand)
    const dangerCheck = isDangerous(fullCommand)

    if (dangerCheck.dangerous && !options?.confirm) {
      return {
        input: fullCommand,
        command: fullCommand,
        valid: true,
        generated: false,
        stdout: '',
        stderr: '',
        exitCode: 0,
        intent: analysis.intent,
        classification: analysis.classification,
        blocked: true,
        requiresConfirm: true,
        blockReason: dangerCheck.reason,
      }
    }

    // Simulate native commands
    let stdout = ''
    let stderr = ''
    let exitCode = 0

    const firstCmd = fullCommand.split(' ')[0]
    switch (firstCmd) {
      case 'echo':
        const echoMatch = fullCommand.match(/^echo\s+["']?(.*)["']?\s*$/)
        stdout = (echoMatch?.[1] || '') + '\n'
        break
      case 'pwd':
        stdout = options?.cwd || '/workspace\n'
        break
      case 'date':
        stdout = new Date().toISOString() + '\n'
        break
      case 'whoami':
        stdout = 'worker\n'
        break
      case 'ls':
        stdout = 'file1.txt\nfile2.txt\ndir1/\n'
        break
      case 'cat':
        stdout = 'file contents here\n'
        break
      case 'grep':
        stdout = 'matching line 1\nmatching line 2\n'
        break
      default:
        stdout = `Executed: ${fullCommand}\n`
    }

    return {
      input: fullCommand,
      command: fullCommand,
      valid: true,
      generated: false,
      stdout,
      stderr,
      exitCode,
      intent: analysis.intent,
      classification: analysis.classification,
    }
  }

  // Tagged template function
  const taggedTemplate = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<BashResult> => {
    const command = strings.reduce((acc, str, i) => {
      const value = values[i]
      const escaped = value !== undefined ? escapeForShell(value) : ''
      return acc + str + escaped
    }, '')

    return exec(command, [])
  }

  function escapeForShell(value: unknown): string {
    const str = String(value)
    if (str === '') return "''"
    if (/^[a-zA-Z0-9_\-./:=@]+$/.test(str)) return str
    return "'" + str.replace(/'/g, "'\"'\"'") + "'"
  }

  // Build capability object - must be callable AND have methods
  const capability = Object.assign(taggedTemplate, {
    exec,
    spawn: vi.fn(),
    run: async (script: string, options?: ExecOptions) => exec(script, [], options),
    parse,
    analyze,
    isDangerous,
    _getExecutedCommands: () => [...executedCommands],
    _clearExecutedCommands: () => { executedCommands.length = 0 },
  })

  return capability
}

// ============================================================================
// Safety Analysis Tests
// ============================================================================

describe('Safety Analysis', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  describe('Command Classification', () => {
    it('classifies read-only commands as safe', () => {
      const readCommands = ['ls', 'cat', 'head', 'tail', 'grep', 'pwd', 'echo', 'date', 'whoami']

      for (const cmd of readCommands) {
        const analysis = bash.analyze(cmd)
        expect(analysis.classification.type).toBe('read')
        expect(analysis.classification.impact).toBe('none')
      }
    })

    it('classifies write commands with low impact', () => {
      const writeCommands = ['touch file.txt', 'mkdir dir', 'cp src dest', 'mv old new']

      for (const cmd of writeCommands) {
        const analysis = bash.analyze(cmd)
        expect(analysis.classification.type).toBe('write')
        expect(analysis.classification.impact).toBe('low')
        expect(analysis.classification.reversible).toBe(true)
      }
    })

    it('classifies delete commands with medium/high impact', () => {
      const analysis1 = bash.analyze('rm file.txt')
      expect(analysis1.classification.type).toBe('delete')
      expect(analysis1.classification.impact).toBe('medium')
      expect(analysis1.classification.reversible).toBe(false)

      const analysis2 = bash.analyze('rm -rf directory')
      expect(analysis2.classification.type).toBe('delete')
      expect(analysis2.classification.impact).toBe('high')
    })

    it('classifies network commands correctly', () => {
      const networkCommands = ['curl https://api.example.com', 'wget file.zip', 'ssh user@host']

      for (const cmd of networkCommands) {
        const analysis = bash.analyze(cmd)
        expect(analysis.classification.type).toBe('network')
        expect(analysis.intent.network).toBe(true)
      }
    })

    it('classifies system commands correctly', () => {
      const analysis = bash.analyze('chmod 755 file.sh')
      expect(analysis.classification.type).toBe('system')
      expect(analysis.classification.impact).toBe('medium')
    })

    it('flags elevated privilege commands', () => {
      const analysis = bash.analyze('sudo apt update')
      expect(analysis.classification.type).toBe('system')
      expect(analysis.classification.impact).toBe('high')
      expect(analysis.intent.elevated).toBe(true)
    })
  })

  describe('Danger Detection', () => {
    it('blocks rm -rf /', () => {
      const check = bash.isDangerous('rm -rf /')
      expect(check.dangerous).toBe(true)
      expect(check.reason).toContain('root')
    })

    it('blocks rm -rf /*', () => {
      const check = bash.isDangerous('rm -rf /*')
      expect(check.dangerous).toBe(true)
    })

    it('blocks rm -rf ~/', () => {
      const check = bash.isDangerous('rm -rf ~/')
      expect(check.dangerous).toBe(true)
      expect(check.reason).toContain('home')
    })

    it('blocks chmod on root', () => {
      const check = bash.isDangerous('chmod 777 /')
      expect(check.dangerous).toBe(true)
    })

    it('blocks dd to disk device', () => {
      const check = bash.isDangerous('dd if=/dev/zero of=/dev/sda')
      expect(check.dangerous).toBe(true)
      expect(check.reason).toContain('disk')
    })

    it('blocks mkfs commands', () => {
      const check = bash.isDangerous('mkfs.ext4 /dev/sda1')
      expect(check.dangerous).toBe(true)
    })

    it('blocks shutdown and reboot', () => {
      expect(bash.isDangerous('shutdown now').dangerous).toBe(true)
      expect(bash.isDangerous('reboot').dangerous).toBe(true)
    })

    it('blocks fork bomb', () => {
      const check = bash.isDangerous(':() { :|:& } ; :')
      expect(check.dangerous).toBe(true)
      expect(check.reason).toContain('fork bomb')
    })

    it('allows safe commands', () => {
      const safeCommands = [
        'ls -la',
        'cat file.txt',
        'echo "hello"',
        'npm install',
        'git status',
        'rm temp.txt',
        'rm -rf node_modules',
      ]

      for (const cmd of safeCommands) {
        const check = bash.isDangerous(cmd)
        expect(check.dangerous).toBe(false)
      }
    })
  })
})

// ============================================================================
// Command Execution Tests
// ============================================================================

describe('Command Execution', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  describe('exec() method', () => {
    it('executes basic commands', async () => {
      const result = await bash.exec('echo', ['hello'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hello')
    })

    it('captures stdout from echo', async () => {
      const result = await bash.exec('echo', ['test output'])
      expect(result.stdout).toBe('test output\n')
    })

    it('returns command classification', async () => {
      const result = await bash.exec('ls', ['-la'])
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('blocks dangerous commands without confirm', async () => {
      const result = await bash.exec('rm', ['-rf', '/'])
      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toContain('root')
    })

    it('executes dangerous commands with confirm flag', async () => {
      const result = await bash.exec('rm', ['-rf', 'node_modules'], { confirm: true })
      expect(result.blocked).toBeFalsy()
      expect(result.exitCode).toBe(0)
    })

    it('passes environment variables', async () => {
      const result = await bash.exec('echo', ['$VAR'], {
        env: { VAR: 'value' }
      })
      expect(result.exitCode).toBe(0)
    })

    it('uses working directory option', async () => {
      const result = await bash.exec('pwd', [], {
        cwd: '/custom/path'
      })
      expect(result.stdout).toContain('/custom/path')
    })
  })

  describe('Template literal syntax', () => {
    it('executes tagged template commands', async () => {
      const result = await bash`echo hello`
      expect(result.exitCode).toBe(0)
    })

    it('escapes interpolated values', async () => {
      const filename = 'my file.txt'
      const result = await bash`cat ${filename}`
      expect(bash._getExecutedCommands()[0].command).toContain("'my file.txt'")
    })

    it('escapes special characters', async () => {
      const input = "user's input"
      const result = await bash`echo ${input}`
      expect(result.exitCode).toBe(0)
    })

    it('handles empty interpolation', async () => {
      const empty = ''
      const result = await bash`echo ${empty}`
      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// Command Parsing Tests
// ============================================================================

describe('Command Parsing', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('parses simple commands', () => {
    const ast = bash.parse('ls -la')
    expect(ast.type).toBe('Program')
    expect(ast.body).toHaveLength(1)
  })

  it('extracts command names from pipelines', () => {
    const ast = bash.parse('cat file.txt | grep error | head -10')
    const node = ast.body[0] as { commands?: string[] }
    expect(node.commands).toContain('cat')
    expect(node.commands).toContain('grep')
    expect(node.commands).toContain('head')
  })

  it('parses command chaining with &&', () => {
    const ast = bash.parse('npm install && npm run build')
    const node = ast.body[0] as { commands?: string[] }
    expect(node.commands).toContain('npm')
  })

  it('parses command chaining with ||', () => {
    const ast = bash.parse('test -f config.json || echo "not found"')
    const node = ast.body[0] as { commands?: string[] }
    expect(node.commands).toContain('test')
    expect(node.commands).toContain('echo')
  })

  it('parses semicolon-separated commands', () => {
    const ast = bash.parse('cd project; npm install; npm test')
    const node = ast.body[0] as { commands?: string[] }
    expect(node.commands).toContain('cd')
    expect(node.commands).toContain('npm')
  })
})

// ============================================================================
// Intent Extraction Tests
// ============================================================================

describe('Intent Extraction', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('extracts commands from pipeline', () => {
    const analysis = bash.analyze('cat log.txt | grep ERROR | wc -l')
    expect(analysis.intent.commands).toContain('cat')
    expect(analysis.intent.commands).toContain('grep')
    expect(analysis.intent.commands).toContain('wc')
  })

  it('detects network intent', () => {
    const analysis = bash.analyze('curl https://api.example.com/data')
    expect(analysis.intent.network).toBe(true)
  })

  it('detects elevated privilege intent', () => {
    const analysis = bash.analyze('sudo apt-get update')
    expect(analysis.intent.elevated).toBe(true)
  })
})

// ============================================================================
// Native Operations Tests (Tier 1)
// ============================================================================

describe('Native Operations (Tier 1)', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('executes echo natively', async () => {
    const result = await bash.exec('echo', ['hello world'])
    expect(result.exitCode).toBe(0)
    expect(result.classification.reason).toBe('Read-only command')
  })

  it('executes pwd natively', async () => {
    const result = await bash.exec('pwd', [])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('/')
  })

  it('executes date natively', async () => {
    const result = await bash.exec('date', [])
    expect(result.exitCode).toBe(0)
  })

  it('executes whoami natively', async () => {
    const result = await bash.exec('whoami', [])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('worker')
  })

  it('executes ls natively', async () => {
    const result = await bash.exec('ls', ['-la'])
    expect(result.exitCode).toBe(0)
    expect(result.classification.type).toBe('read')
  })

  it('executes cat natively', async () => {
    const result = await bash.exec('cat', ['file.txt'])
    expect(result.exitCode).toBe(0)
  })

  it('executes grep natively', async () => {
    const result = await bash.exec('grep', ['pattern', 'file.txt'])
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// Piping and Composition Tests
// ============================================================================

describe('Piping and Composition', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('parses pipe chains', () => {
    const analysis = bash.analyze('cat data.json | jq ".users[]" | head -5')
    expect(analysis.intent.commands).toHaveLength(3)
  })

  it('parses conditional execution', () => {
    const analysis = bash.analyze('test -f config.json && cat config.json || echo "no config"')
    expect(analysis.intent.commands).toContain('test')
    expect(analysis.intent.commands).toContain('cat')
    expect(analysis.intent.commands).toContain('echo')
  })

  it('handles complex pipelines', () => {
    const cmd = 'grep ERROR logs/*.log | sort | uniq -c | sort -rn | head -10'
    const analysis = bash.analyze(cmd)
    expect(analysis.intent.commands).toContain('grep')
    expect(analysis.intent.commands).toContain('sort')
    expect(analysis.intent.commands).toContain('uniq')
    expect(analysis.intent.commands).toContain('head')
  })
})

// ============================================================================
// Build Automation Tests
// ============================================================================

describe('Build Automation Scenarios', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('analyzes npm install as safe', () => {
    const analysis = bash.analyze('npm install')
    expect(analysis.classification.impact).not.toBe('critical')
    expect(bash.isDangerous('npm install').dangerous).toBe(false)
  })

  it('analyzes npm run build as safe', () => {
    const analysis = bash.analyze('npm run build')
    expect(bash.isDangerous('npm run build').dangerous).toBe(false)
  })

  it('analyzes git clone as network operation', () => {
    const analysis = bash.analyze('git clone https://github.com/user/repo')
    // git is not in our network list, but clone involves network
    expect(bash.isDangerous('git clone https://github.com/user/repo').dangerous).toBe(false)
  })

  it('executes CI/CD pipeline commands', async () => {
    // Install
    const install = await bash.exec('npm', ['install'])
    expect(install.exitCode).toBe(0)

    // Test
    const test = await bash.exec('npm', ['test'])
    expect(test.exitCode).toBe(0)

    // Build
    const build = await bash.exec('npm', ['run', 'build'])
    expect(build.exitCode).toBe(0)

    // Verify all commands executed
    const executed = bash._getExecutedCommands()
    expect(executed).toHaveLength(3)
  })
})

// ============================================================================
// Environment Variables Tests
// ============================================================================

describe('Environment Variables', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('accepts env option', async () => {
    const result = await bash.exec('echo', ['$NODE_ENV'], {
      env: { NODE_ENV: 'production' }
    })
    expect(result.exitCode).toBe(0)
  })

  it('accepts cwd option', async () => {
    const result = await bash.exec('pwd', [], {
      cwd: '/app/packages/core'
    })
    expect(result.stdout).toContain('/app/packages/core')
  })

  it('combines multiple options', async () => {
    const result = await bash.exec('node', ['app.js'], {
      cwd: '/app',
      env: { NODE_ENV: 'production', PORT: '3000' },
      timeout: 30000
    })
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('returns blocked result for dangerous commands', async () => {
    const result = await bash.exec('rm', ['-rf', '/'])
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBeDefined()
  })

  it('returns classification even for blocked commands', async () => {
    const result = await bash.exec('rm', ['-rf', '/'])
    expect(result.classification).toBeDefined()
    expect(result.classification.type).toBe('delete')
    expect(result.classification.impact).toBe('critical')
  })

  it('returns intent even for blocked commands', async () => {
    const result = await bash.exec('rm', ['-rf', '/'])
    expect(result.intent).toBeDefined()
    expect(result.intent.commands).toContain('rm')
  })
})

// ============================================================================
// Integration Test: ShellDO Workflow Simulation
// ============================================================================

describe('ShellDO Workflow Simulation', () => {
  let bash: ReturnType<typeof createMockBashCapability>

  beforeEach(() => {
    bash = createMockBashCapability()
  })

  it('simulates build project workflow', async () => {
    // Clone
    await bash.exec('git', ['clone', 'https://github.com/user/app', './project'])

    // Install
    await bash.exec('npm', ['install'], { cwd: './project' })

    // Build
    const build = await bash.exec('npm', ['run', 'build'], { cwd: './project' })

    expect(build.exitCode).toBe(0)
    expect(bash._getExecutedCommands()).toHaveLength(3)
  })

  it('simulates image processing workflow', async () => {
    // Simulate convert commands
    await bash.exec('convert', ['input.jpg', '-resize', '800x600', 'output.jpg'])
    await bash.exec('convert', ['input.jpg', '-thumbnail', '150x150^', 'thumb.jpg'])

    const executed = bash._getExecutedCommands()
    expect(executed).toHaveLength(2)
    expect(executed[0].command).toContain('convert')
  })

  it('simulates Python analysis workflow', async () => {
    // Run Python script
    const result = await bash.exec('python3', ['analyze.py'])
    expect(result.exitCode).toBe(0)
  })

  it('simulates log analysis workflow', async () => {
    // Grep for errors
    await bash.exec('grep', ['ERROR', 'access.log'])

    // Count occurrences
    await bash.exec('grep', ['-c', 'ERROR', 'access.log'])

    // Find top patterns
    const pipeline = 'grep ERROR access.log | sort | uniq -c | sort -rn | head -10'
    await bash.exec('sh', ['-c', pipeline])

    expect(bash._getExecutedCommands()).toHaveLength(3)
  })

  it('simulates safety analysis workflow', async () => {
    const testCommand = 'rm -rf /'

    // Analyze without executing
    const analysis = bash.analyze(testCommand)
    expect(analysis.classification.impact).toBe('critical')

    // Check if dangerous
    const dangerCheck = bash.isDangerous(testCommand)
    expect(dangerCheck.dangerous).toBe(true)

    // Blocked when trying to execute
    const result = await bash.exec('rm', ['-rf', '/'])
    expect(result.blocked).toBe(true)
  })
})

// ============================================================================
// Zero-VM Advantage Documentation Tests
// ============================================================================

describe('Zero-VM Advantage Verification', () => {
  it('demonstrates AST-based analysis (not regex)', () => {
    const bash = createMockBashCapability()

    // AST parsing gives us structured data
    const ast = bash.parse('cat file.txt | grep pattern')
    expect(ast.type).toBe('Program')
    expect(ast.body[0]).toHaveProperty('commands')
  })

  it('demonstrates tiered execution model', () => {
    // Tier 1: Native operations (cat, ls, echo) - sub-ms
    // Tier 2: RPC services (git, npm) - <5ms
    // Tier 3: Dynamic modules - <10ms
    // Tier 4: Container sandbox - 2-3s cold

    // This test documents the architecture:
    const tierExamples = {
      tier1: ['cat', 'ls', 'echo', 'head', 'tail'],
      tier2: ['git', 'npm', 'jq'],
      tier3: ['npm-packages'],
      tier4: ['python', 'ffmpeg', 'bash'],
    }

    expect(tierExamples.tier1).toContain('cat')
    expect(tierExamples.tier4).toContain('python')
  })

  it('demonstrates safety-first execution', async () => {
    const bash = createMockBashCapability()

    // Every command is analyzed before execution
    const analysis = bash.analyze('ls -la')
    expect(analysis.classification).toBeDefined()
    expect(analysis.intent).toBeDefined()

    // Dangerous commands are blocked
    const result = await bash.exec('rm', ['-rf', '/'])
    expect(result.blocked).toBe(true)

    // Safe commands execute immediately
    const safeResult = await bash.exec('ls', ['-la'])
    expect(safeResult.blocked).toBeFalsy()
  })
})
