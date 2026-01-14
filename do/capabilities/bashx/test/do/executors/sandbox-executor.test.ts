/**
 * SandboxExecutor Module Tests (RED)
 *
 * Tests for the SandboxExecutor module that will be extracted from TieredExecutor.
 * SandboxExecutor handles Tier 4 operations: true Linux sandbox execution via Sandbox SDK.
 *
 * This includes:
 * - System/process management (ps, kill, killall, top)
 * - Network tools (ping, ssh, scp, nc, netstat)
 * - Package managers (apt, yum, brew)
 * - Containers (docker, kubectl, podman)
 * - Compilers/runtimes (gcc, python, go, rust, ruby, perl)
 * - System utilities (sudo, su)
 * - Shell execution (bash, sh, zsh)
 *
 * Tests are written to FAIL until the module is implemented.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Import types and classes that don't exist yet - this will cause compilation errors
import type {
  SandboxExecutorConfig,
  SandboxBinding,
  SandboxSession,
  SandboxCapability,
  SandboxResult,
  SandboxSpawnHandle,
} from '../../../src/do/executors/sandbox-executor.js'

import {
  SandboxExecutor,
  createSandboxExecutor,
  SANDBOX_COMMANDS,
  SANDBOX_CATEGORIES,
} from '../../../src/do/executors/sandbox-executor.js'

import type { BashResult, ExecOptions, SpawnOptions, SpawnHandle } from '../../../src/types.js'

// ============================================================================
// Mock Sandbox for Testing
// ============================================================================

function createMockSandboxBinding(): SandboxBinding {
  return {
    execute: vi.fn(async (command: string, options?: ExecOptions): Promise<BashResult> => {
      return {
        input: command,
        command,
        stdout: `sandbox output: ${command}`,
        stderr: '',
        exitCode: 0,
        valid: true,
        generated: false,
        intent: {
          action: 'execute',
          target: command,
          confidence: 1.0,
        },
        classification: {
          level: 'low',
          category: 'system',
          reason: 'Sandbox execution',
        },
      }
    }),
    spawn: vi.fn(async (command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> => {
      return {
        pid: 12345,
        stdin: {
          write: vi.fn(async (data: string) => {}),
          close: vi.fn(async () => {}),
        },
        stdout: {
          on: vi.fn((event: string, callback: (data: string) => void) => {
            if (event === 'data') {
              callback('spawned output')
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event: string, callback: (code: number) => void) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 10)
          }
        }),
        kill: vi.fn(async () => {}),
        wait: vi.fn(async () => ({ exitCode: 0 })),
      }
    }),
  }
}

function createMockSandboxSession(): SandboxSession {
  return {
    id: 'session-123',
    execute: vi.fn(async (command: string) => ({
      stdout: 'session output',
      stderr: '',
      exitCode: 0,
    })),
    spawn: vi.fn(async () => ({} as SpawnHandle)),
    getWorkingDirectory: vi.fn(() => '/home/user'),
    setWorkingDirectory: vi.fn(async () => {}),
    getEnvironment: vi.fn(() => ({})),
    setEnvironment: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isActive: vi.fn(() => true),
  }
}

// ============================================================================
// SandboxExecutor Class Tests
// ============================================================================

describe('SandboxExecutor', () => {
  describe('Construction', () => {
    it('should create an instance with no config', () => {
      const executor = new SandboxExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(SandboxExecutor)
    })

    it('should create an instance with sandbox binding', () => {
      const sandbox = createMockSandboxBinding()
      const executor = new SandboxExecutor({ sandbox })

      expect(executor).toBeDefined()
      expect(executor.hasSandbox).toBe(true)
    })

    it('should create an instance via factory function', () => {
      const executor = createSandboxExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(SandboxExecutor)
    })

    it('should create an instance with config via factory function', () => {
      const sandbox = createMockSandboxBinding()
      const executor = createSandboxExecutor({ sandbox })

      expect(executor).toBeDefined()
      expect(executor.hasSandbox).toBe(true)
    })

    it('should configure default timeout', () => {
      const executor = new SandboxExecutor({ defaultTimeout: 60000 })

      expect(executor.defaultTimeout).toBe(60000)
    })
  })

  describe('Command Classification', () => {
    let executor: SandboxExecutor

    beforeEach(() => {
      executor = new SandboxExecutor({ sandbox: createMockSandboxBinding() })
    })

    it('should identify sandbox commands', () => {
      expect(executor.canExecute('docker')).toBe(true)
      expect(executor.canExecute('kubectl')).toBe(true)
      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('bash')).toBe(true)
    })

    it('should accept any command (sandbox is catch-all)', () => {
      // Sandbox executor should be able to handle any command
      // since it's the fallback tier
      expect(executor.canExecute('any-unknown-command')).toBe(true)
      expect(executor.canExecute('custom-tool')).toBe(true)
    })

    it('should identify command categories', () => {
      expect(executor.getCommandCategory('docker')).toBe('container')
      expect(executor.getCommandCategory('kubectl')).toBe('container')
      expect(executor.getCommandCategory('python')).toBe('runtime')
      expect(executor.getCommandCategory('gcc')).toBe('compiler')
      expect(executor.getCommandCategory('ps')).toBe('process')
      expect(executor.getCommandCategory('ping')).toBe('network')
      expect(executor.getCommandCategory('apt')).toBe('package')
      expect(executor.getCommandCategory('bash')).toBe('shell')
    })

    it('should return general for unknown commands', () => {
      expect(executor.getCommandCategory('custom-tool')).toBe('general')
    })

    it('should check if command is sandbox-specific', () => {
      expect(executor.isSandboxSpecific('docker')).toBe(true)
      expect(executor.isSandboxSpecific('python')).toBe(true)
      expect(executor.isSandboxSpecific('echo')).toBe(false)
      expect(executor.isSandboxSpecific('cat')).toBe(false)
    })
  })

  describe('Basic Execution', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute command via sandbox', async () => {
      const result = await executor.execute('docker ps')

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        'docker ps',
        expect.any(Object)
      )
      expect(result.exitCode).toBe(0)
    })

    it('should pass options to sandbox', async () => {
      await executor.execute('python script.py', {
        cwd: '/app',
        env: { PYTHONPATH: '/lib' },
        timeout: 5000,
      })

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        'python script.py',
        expect.objectContaining({
          cwd: '/app',
          env: { PYTHONPATH: '/lib' },
          timeout: 5000,
        })
      )
    })

    it('should handle successful execution', async () => {
      ;(mockSandbox.execute as Mock).mockResolvedValueOnce({
        input: 'echo hello',
        command: 'echo hello',
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
        valid: true,
        generated: false,
        intent: { action: 'execute', target: 'echo', confidence: 1.0 },
        classification: { level: 'low', category: 'general', reason: 'test' },
      })

      const result = await executor.execute('echo hello')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello\n')
    })

    it('should handle failed execution', async () => {
      ;(mockSandbox.execute as Mock).mockResolvedValueOnce({
        input: 'false',
        command: 'false',
        stdout: '',
        stderr: '',
        exitCode: 1,
        valid: true,
        generated: false,
        intent: { action: 'execute', target: 'false', confidence: 1.0 },
        classification: { level: 'low', category: 'general', reason: 'test' },
      })

      const result = await executor.execute('false')

      expect(result.exitCode).toBe(1)
    })

    it('should handle execution errors', async () => {
      ;(mockSandbox.execute as Mock).mockRejectedValueOnce(
        new Error('Sandbox connection failed')
      )

      await expect(executor.execute('command')).rejects.toThrow(
        'Tier 4 sandbox execution failed'
      )
    })
  })

  describe('Process Management Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute ps command', async () => {
      const result = await executor.execute('ps aux')

      expect(result.exitCode).toBe(0)
    })

    it('should execute kill command', async () => {
      const result = await executor.execute('kill -9 1234')

      expect(result.exitCode).toBe(0)
    })

    it('should execute killall command', async () => {
      const result = await executor.execute('killall node')

      expect(result.exitCode).toBe(0)
    })

    it('should execute top in batch mode', async () => {
      const result = await executor.execute('top -b -n 1')

      expect(result.exitCode).toBe(0)
    })

    it('should execute htop in batch mode', async () => {
      const result = await executor.execute('htop -t')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Network Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute ping command', async () => {
      const result = await executor.execute('ping -c 3 google.com')

      expect(result.exitCode).toBe(0)
    })

    it('should execute ssh command', async () => {
      const result = await executor.execute('ssh user@host "echo hello"')

      expect(result.exitCode).toBe(0)
    })

    it('should execute scp command', async () => {
      const result = await executor.execute('scp file.txt user@host:/path/')

      expect(result.exitCode).toBe(0)
    })

    it('should execute nc (netcat) command', async () => {
      const result = await executor.execute('nc -z localhost 8080')

      expect(result.exitCode).toBe(0)
    })

    it('should execute netstat command', async () => {
      const result = await executor.execute('netstat -tuln')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Container Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute docker ps', async () => {
      const result = await executor.execute('docker ps')

      expect(result.exitCode).toBe(0)
    })

    it('should execute docker run', async () => {
      const result = await executor.execute('docker run alpine echo hello')

      expect(result.exitCode).toBe(0)
    })

    it('should execute docker-compose up', async () => {
      const result = await executor.execute('docker-compose up -d')

      expect(result.exitCode).toBe(0)
    })

    it('should execute kubectl get pods', async () => {
      const result = await executor.execute('kubectl get pods')

      expect(result.exitCode).toBe(0)
    })

    it('should execute kubectl apply', async () => {
      const result = await executor.execute('kubectl apply -f deployment.yaml')

      expect(result.exitCode).toBe(0)
    })

    it('should execute podman commands', async () => {
      const result = await executor.execute('podman ps')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Compiler/Runtime Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute python script', async () => {
      const result = await executor.execute('python script.py')

      expect(result.exitCode).toBe(0)
    })

    it('should execute python3', async () => {
      const result = await executor.execute('python3 -c "print(1+1)"')

      expect(result.exitCode).toBe(0)
    })

    it('should execute gcc compilation', async () => {
      const result = await executor.execute('gcc -o program program.c')

      expect(result.exitCode).toBe(0)
    })

    it('should execute g++ compilation', async () => {
      const result = await executor.execute('g++ -o program program.cpp')

      expect(result.exitCode).toBe(0)
    })

    it('should execute go build', async () => {
      const result = await executor.execute('go build -o app main.go')

      expect(result.exitCode).toBe(0)
    })

    it('should execute rustc', async () => {
      const result = await executor.execute('rustc main.rs')

      expect(result.exitCode).toBe(0)
    })

    it('should execute cargo build', async () => {
      const result = await executor.execute('cargo build --release')

      expect(result.exitCode).toBe(0)
    })

    it('should execute ruby script', async () => {
      const result = await executor.execute('ruby script.rb')

      expect(result.exitCode).toBe(0)
    })

    it('should execute perl script', async () => {
      const result = await executor.execute('perl script.pl')

      expect(result.exitCode).toBe(0)
    })

    it('should execute clang', async () => {
      const result = await executor.execute('clang -o program program.c')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Package Manager Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute apt install', async () => {
      const result = await executor.execute('apt install package')

      expect(result.exitCode).toBe(0)
    })

    it('should execute apt-get update', async () => {
      const result = await executor.execute('apt-get update')

      expect(result.exitCode).toBe(0)
    })

    it('should execute yum install', async () => {
      const result = await executor.execute('yum install package')

      expect(result.exitCode).toBe(0)
    })

    it('should execute dnf install', async () => {
      const result = await executor.execute('dnf install package')

      expect(result.exitCode).toBe(0)
    })

    it('should execute brew install', async () => {
      const result = await executor.execute('brew install package')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Shell Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute bash script', async () => {
      const result = await executor.execute('bash script.sh')

      expect(result.exitCode).toBe(0)
    })

    it('should execute sh script', async () => {
      const result = await executor.execute('sh script.sh')

      expect(result.exitCode).toBe(0)
    })

    it('should execute zsh script', async () => {
      const result = await executor.execute('zsh script.zsh')

      expect(result.exitCode).toBe(0)
    })

    it('should execute bash -c command', async () => {
      const result = await executor.execute('bash -c "echo hello && echo world"')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('System Utility Commands', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should execute sudo command', async () => {
      const result = await executor.execute('sudo apt update')

      expect(result.exitCode).toBe(0)
    })

    it('should execute su command', async () => {
      const result = await executor.execute('su - user -c "command"')

      expect(result.exitCode).toBe(0)
    })

    it('should execute chgrp command', async () => {
      const result = await executor.execute('chgrp group file')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Spawn Execution', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should spawn process via sandbox', async () => {
      const handle = await executor.spawn('python', ['-u', 'server.py'])

      expect(mockSandbox.spawn).toHaveBeenCalledWith(
        'python',
        ['-u', 'server.py'],
        expect.any(Object)
      )
      expect(handle.pid).toBeDefined()
    })

    it('should allow writing to stdin', async () => {
      const handle = await executor.spawn('python', [])

      await handle.stdin.write('print("hello")')
      expect(handle.stdin.write).toHaveBeenCalled()
    })

    it('should allow reading from stdout', async () => {
      const handle = await executor.spawn('python', ['-c', 'print("hello")'])

      let output = ''
      handle.stdout.on('data', (data: string) => {
        output += data
      })

      expect(output).toBe('spawned output')
    })

    it('should allow killing the process', async () => {
      const handle = await executor.spawn('long-running-process', [])

      await handle.kill()
      expect(handle.kill).toHaveBeenCalled()
    })

    it('should wait for process completion', async () => {
      const handle = await executor.spawn('quick-process', [])

      const result = await handle.wait()
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Session Management', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should create a session', async () => {
      const session = await executor.createSession()

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
    })

    it('should execute within session', async () => {
      const session = await executor.createSession()
      const result = await session.execute('cd /app && pwd')

      expect(result.exitCode).toBe(0)
    })

    it('should maintain working directory in session', async () => {
      const session = await executor.createSession()

      await session.execute('cd /app')
      const cwd = session.getWorkingDirectory()

      expect(cwd).toBeDefined()
    })

    it('should maintain environment in session', async () => {
      const session = await executor.createSession()

      await session.setEnvironment({ MY_VAR: 'value' })
      const env = session.getEnvironment()

      expect(env.MY_VAR).toBe('value')
    })

    it('should close session', async () => {
      const session = await executor.createSession()

      await session.close()
      expect(session.isActive()).toBe(false)
    })

    it('should list active sessions', async () => {
      await executor.createSession()
      await executor.createSession()

      const sessions = executor.getActiveSessions()
      expect(sessions.length).toBe(2)
    })

    it('should close all sessions', async () => {
      await executor.createSession()
      await executor.createSession()

      await executor.closeAllSessions()
      const sessions = executor.getActiveSessions()

      expect(sessions.length).toBe(0)
    })
  })

  describe('Error Handling', () => {
    let executor: SandboxExecutor

    beforeEach(() => {
      executor = new SandboxExecutor()
    })

    it('should fail when no sandbox is available', async () => {
      const result = await executor.execute('docker ps')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No sandbox available')
    })

    it('should fail spawn when no sandbox is available', async () => {
      await expect(executor.spawn('python', [])).rejects.toThrow(
        'No sandbox available for spawn'
      )
    })

    it('should handle sandbox timeout', async () => {
      const mockSandbox = createMockSandboxBinding()
      ;(mockSandbox.execute as Mock).mockImplementation(
        () => new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      )

      executor = new SandboxExecutor({ sandbox: mockSandbox, defaultTimeout: 50 })

      await expect(executor.execute('slow command')).rejects.toThrow()
    })

    it('should handle sandbox crash', async () => {
      const mockSandbox = createMockSandboxBinding()
      ;(mockSandbox.execute as Mock).mockRejectedValue(new Error('Sandbox crashed'))

      executor = new SandboxExecutor({ sandbox: mockSandbox })

      await expect(executor.execute('command')).rejects.toThrow(
        'Tier 4 sandbox execution failed'
      )
    })
  })

  describe('Result Format', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should return BashResult compatible structure', async () => {
      const result = await executor.execute('docker ps')

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
      const result = await executor.execute('docker ps')

      expect(result.classification.reason).toContain('Tier 4')
    })

    it('should include command category in classification', async () => {
      const result = await executor.execute('docker ps')

      expect(result.classification.category).toBe('container')
    })
  })

  describe('Capability Checks', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox })
    })

    it('should report sandbox capabilities', () => {
      const capabilities = executor.getCapabilities()

      expect(capabilities).toContain('execute')
      expect(capabilities).toContain('spawn')
    })

    it('should check if spawn is available', () => {
      expect(executor.canSpawn).toBe(true)
    })

    it('should check if sessions are available', () => {
      expect(executor.canCreateSession).toBe(true)
    })

    it('should report no capabilities without sandbox', () => {
      const noSandboxExecutor = new SandboxExecutor()

      expect(noSandboxExecutor.canSpawn).toBe(false)
      expect(noSandboxExecutor.canCreateSession).toBe(false)
    })
  })

  describe('Timeout Handling', () => {
    let executor: SandboxExecutor
    let mockSandbox: SandboxBinding

    beforeEach(() => {
      mockSandbox = createMockSandboxBinding()
      executor = new SandboxExecutor({ sandbox: mockSandbox, defaultTimeout: 30000 })
    })

    it('should use default timeout', async () => {
      await executor.execute('slow command')

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        'slow command',
        expect.objectContaining({ timeout: 30000 })
      )
    })

    it('should respect custom timeout from options', async () => {
      await executor.execute('quick command', { timeout: 5000 })

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        'quick command',
        expect.objectContaining({ timeout: 5000 })
      )
    })
  })
})

// ============================================================================
// SANDBOX_COMMANDS Tests
// ============================================================================

describe('SANDBOX_COMMANDS', () => {
  it('should export SANDBOX_COMMANDS set', () => {
    expect(SANDBOX_COMMANDS).toBeDefined()
    expect(SANDBOX_COMMANDS).toBeInstanceOf(Set)
  })

  it('should include process management commands', () => {
    expect(SANDBOX_COMMANDS.has('ps')).toBe(true)
    expect(SANDBOX_COMMANDS.has('kill')).toBe(true)
    expect(SANDBOX_COMMANDS.has('killall')).toBe(true)
    expect(SANDBOX_COMMANDS.has('top')).toBe(true)
    expect(SANDBOX_COMMANDS.has('htop')).toBe(true)
  })

  it('should include network commands', () => {
    expect(SANDBOX_COMMANDS.has('ping')).toBe(true)
    expect(SANDBOX_COMMANDS.has('ssh')).toBe(true)
    expect(SANDBOX_COMMANDS.has('scp')).toBe(true)
    expect(SANDBOX_COMMANDS.has('nc')).toBe(true)
    expect(SANDBOX_COMMANDS.has('netstat')).toBe(true)
  })

  it('should include container commands', () => {
    expect(SANDBOX_COMMANDS.has('docker')).toBe(true)
    expect(SANDBOX_COMMANDS.has('docker-compose')).toBe(true)
    expect(SANDBOX_COMMANDS.has('kubectl')).toBe(true)
    expect(SANDBOX_COMMANDS.has('podman')).toBe(true)
  })

  it('should include compiler/runtime commands', () => {
    expect(SANDBOX_COMMANDS.has('gcc')).toBe(true)
    expect(SANDBOX_COMMANDS.has('g++')).toBe(true)
    expect(SANDBOX_COMMANDS.has('clang')).toBe(true)
    expect(SANDBOX_COMMANDS.has('rustc')).toBe(true)
    expect(SANDBOX_COMMANDS.has('cargo')).toBe(true)
    expect(SANDBOX_COMMANDS.has('go')).toBe(true)
    expect(SANDBOX_COMMANDS.has('python')).toBe(true)
    expect(SANDBOX_COMMANDS.has('python3')).toBe(true)
    expect(SANDBOX_COMMANDS.has('ruby')).toBe(true)
    expect(SANDBOX_COMMANDS.has('perl')).toBe(true)
  })

  it('should include package manager commands', () => {
    expect(SANDBOX_COMMANDS.has('apt')).toBe(true)
    expect(SANDBOX_COMMANDS.has('apt-get')).toBe(true)
    expect(SANDBOX_COMMANDS.has('yum')).toBe(true)
    expect(SANDBOX_COMMANDS.has('dnf')).toBe(true)
    expect(SANDBOX_COMMANDS.has('brew')).toBe(true)
  })

  it('should include shell commands', () => {
    expect(SANDBOX_COMMANDS.has('bash')).toBe(true)
    expect(SANDBOX_COMMANDS.has('sh')).toBe(true)
    expect(SANDBOX_COMMANDS.has('zsh')).toBe(true)
  })

  it('should include system utility commands', () => {
    expect(SANDBOX_COMMANDS.has('sudo')).toBe(true)
    expect(SANDBOX_COMMANDS.has('su')).toBe(true)
    expect(SANDBOX_COMMANDS.has('chgrp')).toBe(true)
  })
})

// ============================================================================
// SANDBOX_CATEGORIES Tests
// ============================================================================

describe('SANDBOX_CATEGORIES', () => {
  it('should export SANDBOX_CATEGORIES', () => {
    expect(SANDBOX_CATEGORIES).toBeDefined()
    expect(typeof SANDBOX_CATEGORIES).toBe('object')
  })

  it('should have process category', () => {
    expect(SANDBOX_CATEGORIES.process).toBeDefined()
    expect(SANDBOX_CATEGORIES.process).toContain('ps')
    expect(SANDBOX_CATEGORIES.process).toContain('kill')
    expect(SANDBOX_CATEGORIES.process).toContain('top')
  })

  it('should have network category', () => {
    expect(SANDBOX_CATEGORIES.network).toBeDefined()
    expect(SANDBOX_CATEGORIES.network).toContain('ping')
    expect(SANDBOX_CATEGORIES.network).toContain('ssh')
    expect(SANDBOX_CATEGORIES.network).toContain('netstat')
  })

  it('should have container category', () => {
    expect(SANDBOX_CATEGORIES.container).toBeDefined()
    expect(SANDBOX_CATEGORIES.container).toContain('docker')
    expect(SANDBOX_CATEGORIES.container).toContain('kubectl')
    expect(SANDBOX_CATEGORIES.container).toContain('podman')
  })

  it('should have compiler category', () => {
    expect(SANDBOX_CATEGORIES.compiler).toBeDefined()
    expect(SANDBOX_CATEGORIES.compiler).toContain('gcc')
    expect(SANDBOX_CATEGORIES.compiler).toContain('clang')
    expect(SANDBOX_CATEGORIES.compiler).toContain('rustc')
  })

  it('should have runtime category', () => {
    expect(SANDBOX_CATEGORIES.runtime).toBeDefined()
    expect(SANDBOX_CATEGORIES.runtime).toContain('python')
    expect(SANDBOX_CATEGORIES.runtime).toContain('ruby')
    expect(SANDBOX_CATEGORIES.runtime).toContain('go')
  })

  it('should have package category', () => {
    expect(SANDBOX_CATEGORIES.package).toBeDefined()
    expect(SANDBOX_CATEGORIES.package).toContain('apt')
    expect(SANDBOX_CATEGORIES.package).toContain('yum')
    expect(SANDBOX_CATEGORIES.package).toContain('brew')
  })

  it('should have shell category', () => {
    expect(SANDBOX_CATEGORIES.shell).toBeDefined()
    expect(SANDBOX_CATEGORIES.shell).toContain('bash')
    expect(SANDBOX_CATEGORIES.shell).toContain('sh')
    expect(SANDBOX_CATEGORIES.shell).toContain('zsh')
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('SandboxExecutor Type Definitions', () => {
  it('should have correct SandboxExecutorConfig shape', () => {
    const config: SandboxExecutorConfig = {
      sandbox: createMockSandboxBinding(),
      defaultTimeout: 60000,
    }

    expect(config).toBeDefined()
  })

  it('should have correct SandboxBinding shape', () => {
    const binding: SandboxBinding = {
      execute: async (command: string) => ({
        input: command,
        command,
        stdout: '',
        stderr: '',
        exitCode: 0,
        valid: true,
        generated: false,
        intent: { action: 'execute', target: command, confidence: 1.0 },
        classification: { level: 'low', category: 'general', reason: 'test' },
      }),
      spawn: async () => ({} as SpawnHandle),
    }

    expect(binding).toBeDefined()
    expect(binding.execute).toBeDefined()
    expect(binding.spawn).toBeDefined()
  })

  it('should have correct SandboxSession shape', () => {
    const session: SandboxSession = createMockSandboxSession()

    expect(session.id).toBeDefined()
    expect(session.execute).toBeDefined()
    expect(session.getWorkingDirectory).toBeDefined()
    expect(session.setWorkingDirectory).toBeDefined()
    expect(session.getEnvironment).toBeDefined()
    expect(session.setEnvironment).toBeDefined()
    expect(session.close).toBeDefined()
    expect(session.isActive).toBeDefined()
  })

  it('should have correct SandboxCapability type', () => {
    const capabilities: SandboxCapability[] = [
      'execute',
      'spawn',
      'session',
      'filesystem',
      'network',
    ]

    expect(capabilities.length).toBe(5)
  })

  it('should have correct SandboxResult shape', () => {
    const result: SandboxResult = {
      stdout: 'output',
      stderr: '',
      exitCode: 0,
      duration: 100,
      memoryUsage: 1024,
      cpuTime: 50,
    }

    expect(result).toBeDefined()
  })
})
