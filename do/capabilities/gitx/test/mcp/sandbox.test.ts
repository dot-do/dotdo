import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MCPSandbox,
  SandboxConfig,
  SandboxResult,
  SandboxError,
  SandboxErrorCode,
  ResourceLimits,
  PermissionSet,
  createSandbox,
  SandboxState,
  IsolationLevel,
} from '../../src/mcp/sandbox'

/**
 * Test file for MCP Sandbox Execution
 *
 * This file tests the sandbox environment for executing MCP tools safely,
 * including isolation, resource limits, timeouts, permissions, and error handling.
 *
 * RED phase: These tests should fail because the sandbox implementation
 * doesn't exist yet.
 */

describe('MCP Sandbox Execution', () => {
  describe('Sandbox creation and initialization', () => {
    it('should create a sandbox with default configuration', () => {
      const sandbox = createSandbox()
      expect(sandbox).toBeDefined()
      expect(sandbox).toBeInstanceOf(MCPSandbox)
    })

    it('should create a sandbox with custom configuration', () => {
      const config: SandboxConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024, // 128MB
        isolationLevel: 'strict',
      }
      const sandbox = createSandbox(config)
      expect(sandbox).toBeDefined()
      expect(sandbox.getConfig().timeout).toBe(5000)
      expect(sandbox.getConfig().memoryLimit).toBe(128 * 1024 * 1024)
    })

    it('should have default timeout of 30 seconds', () => {
      const sandbox = createSandbox()
      expect(sandbox.getConfig().timeout).toBe(30000)
    })

    it('should have default memory limit of 256MB', () => {
      const sandbox = createSandbox()
      expect(sandbox.getConfig().memoryLimit).toBe(256 * 1024 * 1024)
    })

    it('should not be running until start() is called', () => {
      const sandbox = createSandbox()
      expect(sandbox.getState()).toBe(SandboxState.IDLE)
    })

    it('should transition to RUNNING state after start()', async () => {
      const sandbox = createSandbox()
      await sandbox.start()
      expect(sandbox.getState()).toBe(SandboxState.RUNNING)
    })

    it('should throw if start() is called twice', async () => {
      const sandbox = createSandbox()
      await sandbox.start()
      await expect(sandbox.start()).rejects.toThrow(/already running|started/i)
    })

    it('should transition to IDLE state after stop()', async () => {
      const sandbox = createSandbox()
      await sandbox.start()
      await sandbox.stop()
      expect(sandbox.getState()).toBe(SandboxState.IDLE)
    })

    it('should throw if stop() is called before start()', async () => {
      const sandbox = createSandbox()
      await expect(sandbox.stop()).rejects.toThrow(/not running|not started/i)
    })

    it('should generate unique sandbox ID', () => {
      const sandbox1 = createSandbox()
      const sandbox2 = createSandbox()
      expect(sandbox1.getId()).not.toBe(sandbox2.getId())
    })
  })

  describe('Isolated execution environment', () => {
    let sandbox: MCPSandbox

    beforeEach(async () => {
      sandbox = createSandbox()
      await sandbox.start()
    })

    afterEach(async () => {
      if (sandbox.getState() === SandboxState.RUNNING) {
        await sandbox.stop()
      }
    })

    it('should execute code in isolated context', async () => {
      const result = await sandbox.execute(() => {
        return 'Hello from sandbox'
      })
      expect(result.value).toBe('Hello from sandbox')
    })

    it('should not share global state between executions', async () => {
      await sandbox.execute(() => {
        ;(globalThis as any).testValue = 'first'
      })

      const result = await sandbox.execute(() => {
        return (globalThis as any).testValue
      })

      expect(result.value).toBeUndefined()
    })

    it('should isolate variables between different sandboxes', async () => {
      const sandbox2 = createSandbox()
      await sandbox2.start()

      await sandbox.execute(() => {
        ;(globalThis as any).sharedVar = 'sandbox1'
      })

      const result = await sandbox2.execute(() => {
        return (globalThis as any).sharedVar
      })

      expect(result.value).toBeUndefined()
      await sandbox2.stop()
    })

    it('should provide isolated environment variables', async () => {
      const sandbox = createSandbox({
        env: {
          CUSTOM_VAR: 'test_value',
        },
      })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        return process.env.CUSTOM_VAR
      })

      expect(result.value).toBe('test_value')
      await sandbox.stop()
    })

    it('should not expose host environment variables by default', async () => {
      const result = await sandbox.execute(() => {
        return process.env.HOME
      })

      expect(result.value).toBeUndefined()
    })

    it('should provide isolated working directory', async () => {
      const sandbox = createSandbox({
        workingDirectory: '/sandbox/workspace',
      })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        return process.cwd()
      })

      expect(result.value).toBe('/sandbox/workspace')
      await sandbox.stop()
    })

    it('should support different isolation levels', () => {
      const strictSandbox = createSandbox({ isolationLevel: 'strict' })
      const normalSandbox = createSandbox({ isolationLevel: 'normal' })
      const laxSandbox = createSandbox({ isolationLevel: 'lax' })

      expect(strictSandbox.getConfig().isolationLevel).toBe('strict')
      expect(normalSandbox.getConfig().isolationLevel).toBe('normal')
      expect(laxSandbox.getConfig().isolationLevel).toBe('lax')
    })

    it('should prevent access to parent process in strict mode', async () => {
      const strictSandbox = createSandbox({ isolationLevel: 'strict' })
      await strictSandbox.start()

      const result = await strictSandbox.execute(() => {
        return process.ppid
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      await strictSandbox.stop()
    })

    it('should isolate file descriptors', async () => {
      const result = await sandbox.execute(() => {
        // Should not have access to parent file descriptors
        return (process as any).fd
      })

      expect(result.value).toBeUndefined()
    })
  })

  describe('Resource limits', () => {
    it('should enforce memory limit', async () => {
      const sandbox = createSandbox({
        memoryLimit: 10 * 1024 * 1024, // 10MB
      })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        // Try to allocate more than 10MB
        const arr: number[] = []
        for (let i = 0; i < 10000000; i++) {
          arr.push(i)
        }
        return arr.length
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.MEMORY_LIMIT_EXCEEDED)
      await sandbox.stop()
    })

    it('should enforce CPU time limit', async () => {
      const sandbox = createSandbox({
        cpuTimeLimit: 100, // 100ms of CPU time
      })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        // CPU-intensive operation
        let sum = 0
        for (let i = 0; i < 1000000000; i++) {
          sum += Math.sqrt(i)
        }
        return sum
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.CPU_LIMIT_EXCEEDED)
      await sandbox.stop()
    })

    it('should enforce file descriptor limit', async () => {
      const sandbox = createSandbox({
        maxOpenFiles: 5,
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const fs = await import('fs')
        const handles: any[] = []
        for (let i = 0; i < 10; i++) {
          handles.push(fs.openSync('/dev/null', 'r'))
        }
        return handles.length
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.FILE_DESCRIPTOR_LIMIT)
      await sandbox.stop()
    })

    it('should enforce process/thread limit', async () => {
      const sandbox = createSandbox({
        maxProcesses: 1,
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const { spawn } = await import('child_process')
        spawn('echo', ['hello'])
        return 'spawned'
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PROCESS_LIMIT_EXCEEDED)
      await sandbox.stop()
    })

    it('should enforce network bandwidth limit', async () => {
      const sandbox = createSandbox({
        networkBandwidthLimit: 1024, // 1KB/s
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        // Attempt large network transfer
        const data = 'x'.repeat(1024 * 1024) // 1MB
        // Simulated network send
        return data.length
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.BANDWIDTH_LIMIT_EXCEEDED)
      await sandbox.stop()
    })

    it('should enforce disk write limit', async () => {
      const sandbox = createSandbox({
        diskWriteLimit: 1024, // 1KB
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const fs = await import('fs')
        const data = 'x'.repeat(1024 * 1024) // 1MB
        fs.writeFileSync('/tmp/test.txt', data)
        return 'written'
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.DISK_LIMIT_EXCEEDED)
      await sandbox.stop()
    })

    it('should report resource usage statistics', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      await sandbox.execute(() => {
        const arr = new Array(1000).fill(0)
        return arr.length
      })

      const stats = sandbox.getResourceStats()
      expect(stats.memoryUsed).toBeGreaterThan(0)
      expect(stats.cpuTimeUsed).toBeGreaterThanOrEqual(0)
      expect(stats.executionCount).toBe(1)
      await sandbox.stop()
    })

    it('should reset resource usage after cleanup', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      await sandbox.execute(() => {
        const arr = new Array(1000).fill(0)
        return arr.length
      })

      await sandbox.cleanup()

      const stats = sandbox.getResourceStats()
      expect(stats.memoryUsed).toBe(0)
      expect(stats.executionCount).toBe(0)
      await sandbox.stop()
    })

    it('should get resource limits configuration', () => {
      const limits: ResourceLimits = {
        memoryLimit: 128 * 1024 * 1024,
        cpuTimeLimit: 5000,
        maxOpenFiles: 100,
        maxProcesses: 10,
        diskWriteLimit: 10 * 1024 * 1024,
      }

      const sandbox = createSandbox({ resourceLimits: limits })
      const configLimits = sandbox.getResourceLimits()

      expect(configLimits.memoryLimit).toBe(limits.memoryLimit)
      expect(configLimits.cpuTimeLimit).toBe(limits.cpuTimeLimit)
      expect(configLimits.maxOpenFiles).toBe(limits.maxOpenFiles)
    })
  })

  describe('Timeout handling', () => {
    it('should timeout execution exceeding default timeout', async () => {
      const sandbox = createSandbox({ timeout: 100 }) // 100ms
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return 'completed'
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.TIMEOUT)
      expect(result.error?.message).toMatch(/timeout|exceeded/i)
      await sandbox.stop()
    })

    it('should respect custom timeout per execution', async () => {
      const sandbox = createSandbox({ timeout: 30000 })
      await sandbox.start()

      const result = await sandbox.execute(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          return 'completed'
        },
        { timeout: 100 }
      )

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.TIMEOUT)
      await sandbox.stop()
    })

    it('should cancel pending operations on timeout', async () => {
      const sandbox = createSandbox({ timeout: 100 })
      await sandbox.start()

      let operationCompleted = false

      const result = await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        operationCompleted = true
        return 'completed'
      })

      expect(result.error?.code).toBe(SandboxErrorCode.TIMEOUT)
      expect(operationCompleted).toBe(false)
      await sandbox.stop()
    })

    it('should cleanup resources after timeout', async () => {
      const sandbox = createSandbox({ timeout: 100 })
      await sandbox.start()

      await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return 'completed'
      })

      const stats = sandbox.getResourceStats()
      expect(stats.activeHandles).toBe(0)
      await sandbox.stop()
    })

    it('should allow extending timeout for specific operations', async () => {
      const sandbox = createSandbox({ timeout: 100 })
      await sandbox.start()

      const result = await sandbox.execute(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return 'completed'
        },
        { timeout: 500 }
      )

      expect(result.error).toBeUndefined()
      expect(result.value).toBe('completed')
      await sandbox.stop()
    })

    it('should report timeout duration in error', async () => {
      const sandbox = createSandbox({ timeout: 150 })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return 'completed'
      })

      expect(result.error?.data?.timeoutMs).toBe(150)
      await sandbox.stop()
    })

    it('should handle synchronous infinite loops', async () => {
      const sandbox = createSandbox({ timeout: 100 })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        while (true) {
          // Infinite loop
        }
      })

      expect(result.error?.code).toBe(SandboxErrorCode.TIMEOUT)
      await sandbox.stop()
    })

    it('should not timeout successful fast operations', async () => {
      const sandbox = createSandbox({ timeout: 1000 })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        return 42
      })

      expect(result.error).toBeUndefined()
      expect(result.value).toBe(42)
      await sandbox.stop()
    })

    it('should include elapsed time in result metadata', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'done'
      })

      expect(result.metadata?.elapsedMs).toBeGreaterThanOrEqual(50)
      await sandbox.stop()
    })
  })

  describe('Permission boundaries', () => {
    it('should deny file system read by default in strict mode', async () => {
      const sandbox = createSandbox({
        isolationLevel: 'strict',
        permissions: { fileRead: false },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const fs = await import('fs')
        return fs.readFileSync('/etc/passwd', 'utf-8')
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      await sandbox.stop()
    })

    it('should deny file system write by default', async () => {
      const sandbox = createSandbox({
        permissions: { fileWrite: false },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const fs = await import('fs')
        fs.writeFileSync('/tmp/test.txt', 'hello')
        return 'written'
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      await sandbox.stop()
    })

    it('should deny network access by default in strict mode', async () => {
      const sandbox = createSandbox({
        isolationLevel: 'strict',
        permissions: { network: false },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const http = await import('http')
        return new Promise((resolve, reject) => {
          http.get('http://example.com.ai', resolve).on('error', reject)
        })
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      await sandbox.stop()
    })

    it('should deny process spawning by default', async () => {
      const sandbox = createSandbox({
        permissions: { spawn: false },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const { execSync } = await import('child_process')
        return execSync('ls').toString()
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      await sandbox.stop()
    })

    it('should allow explicitly granted permissions', async () => {
      const sandbox = createSandbox({
        permissions: {
          fileRead: true,
          allowedPaths: ['/tmp'],
        },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const fs = await import('fs')
        fs.writeFileSync('/tmp/sandbox-test.txt', 'test')
        return fs.readFileSync('/tmp/sandbox-test.txt', 'utf-8')
      })

      // Note: This might still fail if fileWrite is not granted
      // The test verifies the permission system works
      expect(result.error?.code).not.toBe(SandboxErrorCode.PERMISSION_DENIED)
      await sandbox.stop()
    })

    it('should restrict access to paths outside allowed list', async () => {
      const sandbox = createSandbox({
        permissions: {
          fileRead: true,
          allowedPaths: ['/tmp/sandbox'],
        },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        const fs = await import('fs')
        return fs.readFileSync('/etc/passwd', 'utf-8')
      })

      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      expect(result.error?.message).toMatch(/path not allowed|access denied/i)
      await sandbox.stop()
    })

    it('should support permission presets', () => {
      const readOnlySandbox = createSandbox({
        permissionPreset: 'readonly',
      })
      const fullAccessSandbox = createSandbox({
        permissionPreset: 'full',
      })
      const networkOnlySandbox = createSandbox({
        permissionPreset: 'network-only',
      })

      expect(readOnlySandbox.getPermissions().fileWrite).toBe(false)
      expect(fullAccessSandbox.getPermissions().fileWrite).toBe(true)
      expect(networkOnlySandbox.getPermissions().network).toBe(true)
      expect(networkOnlySandbox.getPermissions().fileRead).toBe(false)
    })

    it('should deny access to sensitive environment variables', async () => {
      const sandbox = createSandbox({
        permissions: { env: false },
      })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        return process.env
      })

      expect(result.value).toEqual({})
      await sandbox.stop()
    })

    it('should allow whitelisted environment variables only', async () => {
      const sandbox = createSandbox({
        permissions: {
          env: true,
          envWhitelist: ['NODE_ENV', 'DEBUG'],
        },
        env: {
          NODE_ENV: 'test',
          DEBUG: 'true',
          SECRET_KEY: 'secret',
        },
      })
      await sandbox.start()

      const result = await sandbox.execute(() => {
        return {
          nodeEnv: process.env.NODE_ENV,
          debug: process.env.DEBUG,
          secret: process.env.SECRET_KEY,
        }
      })

      expect(result.value.nodeEnv).toBe('test')
      expect(result.value.debug).toBe('true')
      expect(result.value.secret).toBeUndefined()
      await sandbox.stop()
    })

    it('should deny native module loading in strict mode', async () => {
      const sandbox = createSandbox({
        isolationLevel: 'strict',
        permissions: { nativeModules: false },
      })
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        // Attempt to load a native module
        return await import('fs')
      })

      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      await sandbox.stop()
    })

    it('should track permission violations', async () => {
      const sandbox = createSandbox({
        permissions: { fileRead: false, fileWrite: false },
      })
      await sandbox.start()

      await sandbox.execute(async () => {
        const fs = await import('fs')
        fs.readFileSync('/etc/passwd')
      })

      await sandbox.execute(async () => {
        const fs = await import('fs')
        fs.writeFileSync('/tmp/test.txt', 'data')
      })

      const violations = sandbox.getPermissionViolations()
      expect(violations).toHaveLength(2)
      expect(violations[0].permission).toBe('fileRead')
      expect(violations[1].permission).toBe('fileWrite')
      await sandbox.stop()
    })
  })

  describe('Error isolation', () => {
    it('should catch and contain thrown errors', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        throw new Error('Intentional error')
      })

      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Intentional error')
      expect(result.error?.code).toBe(SandboxErrorCode.EXECUTION_ERROR)
      await sandbox.stop()
    })

    it('should contain uncaught promise rejections', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(async () => {
        throw new Error('Async error')
      })

      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Async error')
      await sandbox.stop()
    })

    it('should not crash sandbox on error', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      await sandbox.execute(() => {
        throw new Error('First error')
      })

      const result = await sandbox.execute(() => {
        return 'Still working'
      })

      expect(result.value).toBe('Still working')
      expect(sandbox.getState()).toBe(SandboxState.RUNNING)
      await sandbox.stop()
    })

    it('should isolate errors between different executions', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result1 = await sandbox.execute(() => {
        throw new Error('Error 1')
      })

      const result2 = await sandbox.execute(() => {
        return 'Success'
      })

      expect(result1.error).toBeDefined()
      expect(result2.error).toBeUndefined()
      expect(result2.value).toBe('Success')
      await sandbox.stop()
    })

    it('should capture stack trace for errors', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        function innerFunction() {
          throw new Error('Deep error')
        }
        innerFunction()
      })

      expect(result.error?.stack).toBeDefined()
      expect(result.error?.stack).toContain('innerFunction')
      await sandbox.stop()
    })

    it('should handle non-Error throws', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        throw 'String error'
      })

      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('String error')
      await sandbox.stop()
    })

    it('should handle null/undefined throws', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        throw null
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.EXECUTION_ERROR)
      await sandbox.stop()
    })

    it('should contain type errors', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        const obj: any = null
        return obj.property
      })

      expect(result.error).toBeDefined()
      expect(result.error?.message).toMatch(/cannot read|null|undefined/i)
      await sandbox.stop()
    })

    it('should contain reference errors', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        return (undefinedVariable as any).value
      })

      expect(result.error).toBeDefined()
      await sandbox.stop()
    })

    it('should block eval for security reasons', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        eval('console.log("blocked")')
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      expect(result.error?.message).toMatch(/eval.*blocked|security/i)
      await sandbox.stop()
    })

    it('should block Function constructor for security reasons', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(() => {
        const fn = new Function('return 42')
        return fn()
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.PERMISSION_DENIED)
      expect(result.error?.message).toMatch(/Function.*blocked|security/i)
      await sandbox.stop()
    })

    it('should prevent error from affecting other sandboxes', async () => {
      const sandbox1 = createSandbox()
      const sandbox2 = createSandbox()
      await sandbox1.start()
      await sandbox2.start()

      await sandbox1.execute(() => {
        throw new Error('Sandbox 1 error')
      })

      const result = await sandbox2.execute(() => {
        return 'Sandbox 2 success'
      })

      expect(result.value).toBe('Sandbox 2 success')
      expect(result.error).toBeUndefined()

      await sandbox1.stop()
      await sandbox2.stop()
    })

    it('should include execution context in error', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const result = await sandbox.execute(
        () => {
          throw new Error('Context error')
        },
        { context: { operation: 'test-op', requestId: '123' } }
      )

      expect(result.error?.data?.context?.operation).toBe('test-op')
      expect(result.error?.data?.context?.requestId).toBe('123')
      await sandbox.stop()
    })
  })

  describe('SandboxError class', () => {
    it('should create SandboxError with code and message', () => {
      const error = new SandboxError(SandboxErrorCode.TIMEOUT, 'Execution timed out')
      expect(error.code).toBe(SandboxErrorCode.TIMEOUT)
      expect(error.message).toBe('Execution timed out')
    })

    it('should be an instance of Error', () => {
      const error = new SandboxError(SandboxErrorCode.PERMISSION_DENIED, 'Access denied')
      expect(error).toBeInstanceOf(Error)
    })

    it('should support optional data property', () => {
      const error = new SandboxError(SandboxErrorCode.MEMORY_LIMIT_EXCEEDED, 'Out of memory', {
        limit: 256 * 1024 * 1024,
        used: 300 * 1024 * 1024,
      })
      expect(error.data).toEqual({
        limit: 256 * 1024 * 1024,
        used: 300 * 1024 * 1024,
      })
    })

    it('should serialize to JSON format', () => {
      const error = new SandboxError(SandboxErrorCode.TIMEOUT, 'Timed out')
      const json = error.toJSON()
      expect(json).toEqual({
        code: SandboxErrorCode.TIMEOUT,
        message: 'Timed out',
      })
    })

    it('should include data in JSON when present', () => {
      const error = new SandboxError(SandboxErrorCode.PERMISSION_DENIED, 'Denied', {
        permission: 'fileRead',
      })
      const json = error.toJSON()
      expect(json.data).toEqual({ permission: 'fileRead' })
    })
  })

  describe('Sandbox error codes', () => {
    it('should have TIMEOUT error code', () => {
      expect(SandboxErrorCode.TIMEOUT).toBeDefined()
    })

    it('should have MEMORY_LIMIT_EXCEEDED error code', () => {
      expect(SandboxErrorCode.MEMORY_LIMIT_EXCEEDED).toBeDefined()
    })

    it('should have CPU_LIMIT_EXCEEDED error code', () => {
      expect(SandboxErrorCode.CPU_LIMIT_EXCEEDED).toBeDefined()
    })

    it('should have PERMISSION_DENIED error code', () => {
      expect(SandboxErrorCode.PERMISSION_DENIED).toBeDefined()
    })

    it('should have EXECUTION_ERROR error code', () => {
      expect(SandboxErrorCode.EXECUTION_ERROR).toBeDefined()
    })

    it('should have FILE_DESCRIPTOR_LIMIT error code', () => {
      expect(SandboxErrorCode.FILE_DESCRIPTOR_LIMIT).toBeDefined()
    })

    it('should have PROCESS_LIMIT_EXCEEDED error code', () => {
      expect(SandboxErrorCode.PROCESS_LIMIT_EXCEEDED).toBeDefined()
    })

    it('should have BANDWIDTH_LIMIT_EXCEEDED error code', () => {
      expect(SandboxErrorCode.BANDWIDTH_LIMIT_EXCEEDED).toBeDefined()
    })

    it('should have DISK_LIMIT_EXCEEDED error code', () => {
      expect(SandboxErrorCode.DISK_LIMIT_EXCEEDED).toBeDefined()
    })

    it('should have SANDBOX_CRASHED error code', () => {
      expect(SandboxErrorCode.SANDBOX_CRASHED).toBeDefined()
    })
  })

  describe('Sandbox result format', () => {
    let sandbox: MCPSandbox

    beforeEach(async () => {
      sandbox = createSandbox()
      await sandbox.start()
    })

    afterEach(async () => {
      if (sandbox.getState() === SandboxState.RUNNING) {
        await sandbox.stop()
      }
    })

    it('should return value for successful execution', async () => {
      const result = await sandbox.execute(() => {
        return { data: 'test' }
      })

      expect(result.value).toEqual({ data: 'test' })
      expect(result.error).toBeUndefined()
    })

    it('should return error for failed execution', async () => {
      const result = await sandbox.execute(() => {
        throw new Error('Test error')
      })

      expect(result.value).toBeUndefined()
      expect(result.error).toBeDefined()
    })

    it('should include execution metadata', async () => {
      const result = await sandbox.execute(() => {
        return 42
      })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.startTime).toBeDefined()
      expect(result.metadata?.endTime).toBeDefined()
      expect(result.metadata?.elapsedMs).toBeGreaterThanOrEqual(0)
    })

    it('should include sandbox ID in result', async () => {
      const result = await sandbox.execute(() => 'test')

      expect(result.sandboxId).toBe(sandbox.getId())
    })

    it('should include resource usage in result', async () => {
      const result = await sandbox.execute(() => {
        const arr = new Array(1000).fill(0)
        return arr.length
      })

      expect(result.resourceUsage).toBeDefined()
      expect(result.resourceUsage?.memoryUsed).toBeGreaterThan(0)
    })

    it('should handle undefined return value', async () => {
      const result = await sandbox.execute(() => {
        const x = 1 + 1
      })

      expect(result.value).toBeUndefined()
      expect(result.error).toBeUndefined()
    })

    it('should handle null return value', async () => {
      const result = await sandbox.execute(() => {
        return null
      })

      expect(result.value).toBeNull()
      expect(result.error).toBeUndefined()
    })

    it('should handle complex return values', async () => {
      const result = await sandbox.execute(() => {
        return {
          string: 'test',
          number: 42,
          boolean: true,
          array: [1, 2, 3],
          nested: { deep: { value: 'found' } },
        }
      })

      expect(result.value.string).toBe('test')
      expect(result.value.number).toBe(42)
      expect(result.value.array).toEqual([1, 2, 3])
      expect(result.value.nested.deep.value).toBe('found')
    })
  })

  describe('Sandbox lifecycle management', () => {
    it('should track sandbox state transitions', async () => {
      const sandbox = createSandbox()

      expect(sandbox.getState()).toBe(SandboxState.IDLE)

      await sandbox.start()
      expect(sandbox.getState()).toBe(SandboxState.RUNNING)

      await sandbox.pause()
      expect(sandbox.getState()).toBe(SandboxState.PAUSED)

      await sandbox.resume()
      expect(sandbox.getState()).toBe(SandboxState.RUNNING)

      await sandbox.stop()
      expect(sandbox.getState()).toBe(SandboxState.IDLE)
    })

    it('should not accept executions when paused', async () => {
      const sandbox = createSandbox()
      await sandbox.start()
      await sandbox.pause()

      const result = await sandbox.execute(() => 'test')

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(SandboxErrorCode.SANDBOX_PAUSED)
    })

    it('should queue executions during pause if configured', async () => {
      const sandbox = createSandbox({ queueOnPause: true })
      await sandbox.start()
      await sandbox.pause()

      const executionPromise = sandbox.execute(() => 'queued')

      await sandbox.resume()
      const result = await executionPromise

      expect(result.value).toBe('queued')
    })

    it('should cleanup resources on destroy', async () => {
      const sandbox = createSandbox()
      await sandbox.start()
      await sandbox.execute(() => 'test')

      await sandbox.destroy()

      expect(sandbox.getState()).toBe(SandboxState.DESTROYED)
      await expect(sandbox.start()).rejects.toThrow(/destroyed/i)
    })

    it('should emit lifecycle events', async () => {
      const sandbox = createSandbox()
      const events: string[] = []

      sandbox.on('stateChange', (state) => events.push(state))

      await sandbox.start()
      await sandbox.stop()

      expect(events).toContain(SandboxState.RUNNING)
      expect(events).toContain(SandboxState.IDLE)
    })

    it('should handle multiple concurrent executions', async () => {
      const sandbox = createSandbox()
      await sandbox.start()

      const results = await Promise.all([
        sandbox.execute(() => 1),
        sandbox.execute(() => 2),
        sandbox.execute(() => 3),
      ])

      expect(results.map((r) => r.value)).toEqual([1, 2, 3])
      await sandbox.stop()
    })

    it('should limit concurrent executions if configured', async () => {
      const sandbox = createSandbox({ maxConcurrentExecutions: 2 })
      await sandbox.start()

      const start = Date.now()
      await Promise.all([
        sandbox.execute(async () => {
          await new Promise((r) => setTimeout(r, 100))
          return 1
        }),
        sandbox.execute(async () => {
          await new Promise((r) => setTimeout(r, 100))
          return 2
        }),
        sandbox.execute(async () => {
          await new Promise((r) => setTimeout(r, 100))
          return 3
        }),
      ])
      const elapsed = Date.now() - start

      // With max 2 concurrent, 3 executions should take at least 200ms
      expect(elapsed).toBeGreaterThanOrEqual(150)
      await sandbox.stop()
    })
  })

  describe('Sandbox pool management', () => {
    it('should create sandbox pool', async () => {
      const { createSandboxPool } = await import('../../src/mcp/sandbox')
      const pool = createSandboxPool({ size: 3 })

      expect(pool).toBeDefined()
      expect(pool.size()).toBe(3)
    })

    it('should acquire and release sandboxes from pool', async () => {
      const { createSandboxPool } = await import('../../src/mcp/sandbox')
      const pool = createSandboxPool({ size: 2 })

      const sandbox1 = await pool.acquire()
      expect(pool.available()).toBe(1)

      const sandbox2 = await pool.acquire()
      expect(pool.available()).toBe(0)

      await pool.release(sandbox1)
      expect(pool.available()).toBe(1)

      await pool.release(sandbox2)
      expect(pool.available()).toBe(2)
    })

    it('should wait for available sandbox when pool exhausted', async () => {
      const { createSandboxPool } = await import('../../src/mcp/sandbox')
      const pool = createSandboxPool({ size: 1 })

      const sandbox1 = await pool.acquire()

      const acquirePromise = pool.acquire()

      // Release first sandbox after delay
      setTimeout(() => pool.release(sandbox1), 100)

      const sandbox2 = await acquirePromise
      expect(sandbox2).toBeDefined()
    })

    it('should timeout when waiting for sandbox too long', async () => {
      const { createSandboxPool } = await import('../../src/mcp/sandbox')
      const pool = createSandboxPool({ size: 1, acquireTimeout: 100 })

      await pool.acquire()

      await expect(pool.acquire()).rejects.toThrow(/timeout|acquire/i)
    })

    it('should cleanup all sandboxes on pool shutdown', async () => {
      const { createSandboxPool } = await import('../../src/mcp/sandbox')
      const pool = createSandboxPool({ size: 3 })

      await pool.shutdown()

      expect(pool.size()).toBe(0)
    })
  })
})
