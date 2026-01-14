import { describe, it, expect, beforeEach } from 'vitest'
import {
  PythonBackend,
  MockBackend,
  ExecResult,
  ExecOptions,
  PyModule,
  Package,
} from '../../core/backend'

describe('PythonBackend interface', () => {
  let backend: PythonBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  describe('exec', () => {
    it('should execute Python code and return ExecResult', async () => {
      ;(backend as MockBackend).setResponse('print("hello")', {
        result: null,
        stdout: 'hello\n',
        stderr: '',
        duration: 5,
      })
      const result = await backend.exec('print("hello")')

      expect(result).toBeDefined()
      expect(result.result).toBeDefined()
      expect(result.stdout).toBe('hello\n')
      expect(result.stderr).toBe('')
      expect(typeof result.duration).toBe('number')
    })

    it('should accept options parameter', async () => {
      ;(backend as MockBackend).setResponse('print(x)', {
        result: null,
        stdout: '42\n',
        stderr: '',
        duration: 1,
      })
      const options: ExecOptions = {
        timeout: 5000,
        globals: { x: 42 },
      }
      const result = await backend.exec('print(x)', options)

      expect(result.stdout).toBe('42\n')
    })

    it('should capture stderr on error', async () => {
      ;(backend as MockBackend).setResponse('raise ValueError("test error")', {
        result: null,
        stdout: '',
        stderr: 'ValueError: test error',
        duration: 1,
      })
      const result = await backend.exec('raise ValueError("test error")')

      expect(result.stderr).toContain('ValueError')
      expect(result.stderr).toContain('test error')
    })

    it('should return execution duration', async () => {
      ;(backend as MockBackend).setResponse('import time; time.sleep(0.1)', {
        result: null,
        stdout: '',
        stderr: '',
        duration: 105,
      })
      const result = await backend.exec('import time; time.sleep(0.1)')

      expect(result.duration).toBeGreaterThanOrEqual(100)
    })
  })

  describe('execWithGlobals', () => {
    it('should execute code with pre-set globals', async () => {
      ;(backend as MockBackend).setResponse('print(name * count)', {
        result: null,
        stdout: 'worldworldworld\n',
        stderr: '',
        duration: 1,
      })
      const globals = { name: 'world', count: 3 }
      const result = await backend.execWithGlobals('print(name * count)', globals)

      expect(result.stdout).toBe('worldworldworld\n')
    })

    it('should allow accessing globals in code', async () => {
      ;(backend as MockBackend).setResponse('result = sum(items)', {
        result: 6,
        stdout: '',
        stderr: '',
        duration: 1,
      })
      const globals = { items: [1, 2, 3] }
      const result = await backend.execWithGlobals('result = sum(items)', globals)

      expect(result.result).toBe(6)
    })
  })

  describe('importModule', () => {
    it('should import a Python module', async () => {
      const mod = await backend.importModule('json')

      expect(mod).toBeDefined()
      expect(mod.name).toBe('json')
    })

    it('should return module with callable functions', async () => {
      const json: PyModule = await backend.importModule('json')

      expect(typeof json.call).toBe('function')
    })

    it('should throw on non-existent module', async () => {
      await expect(backend.importModule('nonexistent_module_xyz'))
        .rejects.toThrow()
    })
  })

  describe('getGlobal', () => {
    it('should get a global variable by name', async () => {
      await backend.setGlobal('my_var', 42)
      const value = await backend.getGlobal('my_var')

      expect(value).toBe(42)
    })

    it('should return undefined for non-existent global', async () => {
      const value = await backend.getGlobal('nonexistent_var')

      expect(value).toBeUndefined()
    })
  })

  describe('setGlobal', () => {
    it('should set a global variable', async () => {
      ;(backend as MockBackend).setResponse('print(my_var)', {
        result: null,
        stdout: 'hello\n',
        stderr: '',
        duration: 1,
      })
      await backend.setGlobal('my_var', 'hello')
      const result = await backend.exec('print(my_var)')

      expect(result.stdout).toBe('hello\n')
    })

    it('should overwrite existing global', async () => {
      await backend.setGlobal('x', 1)
      await backend.setGlobal('x', 2)
      const value = await backend.getGlobal('x')

      expect(value).toBe(2)
    })

    it('should handle complex objects', async () => {
      ;(backend as MockBackend).setResponse('result = data["nested"]["value"][1]', {
        result: 2,
        stdout: '',
        stderr: '',
        duration: 1,
      })
      await backend.setGlobal('data', { nested: { value: [1, 2, 3] } })
      const result = await backend.exec('result = data["nested"]["value"][1]')

      expect(result.result).toBe(2)
    })
  })

  describe('installPackage', () => {
    it('should install a package by name', async () => {
      await backend.installPackage('requests')
      const packages = await backend.listPackages()

      expect(packages.some(p => p.name === 'requests')).toBe(true)
    })

    it('should install a specific version', async () => {
      await backend.installPackage('requests', '2.28.0')
      const packages = await backend.listPackages()

      const pkg = packages.find(p => p.name === 'requests')
      expect(pkg?.version).toBe('2.28.0')
    })
  })

  describe('listPackages', () => {
    it('should return array of installed packages', async () => {
      const packages = await backend.listPackages()

      expect(Array.isArray(packages)).toBe(true)
    })

    it('should include package name and version', async () => {
      await backend.installPackage('numpy')
      const packages = await backend.listPackages()

      const numpy = packages.find(p => p.name === 'numpy')
      expect(numpy).toBeDefined()
      expect(typeof numpy?.version).toBe('string')
    })
  })

  describe('createSnapshot', () => {
    it('should create a snapshot of current state', async () => {
      await backend.setGlobal('x', 42)
      const snapshot = await backend.createSnapshot()

      expect(snapshot).toBeInstanceOf(Uint8Array)
      expect(snapshot.length).toBeGreaterThan(0)
    })
  })

  describe('restoreSnapshot', () => {
    it('should restore state from snapshot', async () => {
      await backend.setGlobal('x', 42)
      const snapshot = await backend.createSnapshot()

      await backend.setGlobal('x', 100)
      await backend.restoreSnapshot(snapshot)

      const value = await backend.getGlobal('x')
      expect(value).toBe(42)
    })

    it('should restore installed packages', async () => {
      await backend.installPackage('requests')
      const snapshot = await backend.createSnapshot()

      await backend.reset()
      await backend.restoreSnapshot(snapshot)

      const packages = await backend.listPackages()
      expect(packages.some(p => p.name === 'requests')).toBe(true)
    })
  })

  describe('reset', () => {
    it('should clear all globals', async () => {
      await backend.setGlobal('x', 42)
      await backend.setGlobal('y', 'hello')
      await backend.reset()

      const x = await backend.getGlobal('x')
      const y = await backend.getGlobal('y')

      expect(x).toBeUndefined()
      expect(y).toBeUndefined()
    })

    it('should reset to clean state', async () => {
      ;(backend as MockBackend).setResponse('hasattr(sys, "my_custom_attr")', {
        result: false,
        stdout: '',
        stderr: '',
        duration: 1,
      })
      await backend.setGlobal('sys', { my_custom_attr: true })
      await backend.reset()

      const result = await backend.exec('hasattr(sys, "my_custom_attr")')
      expect(result.result).toBe(false)
    })
  })
})

describe('MockBackend', () => {
  let mock: MockBackend

  beforeEach(() => {
    mock = new MockBackend()
  })

  describe('simulated execution', () => {
    it('should simulate Python execution', async () => {
      const result = await mock.exec('print("hello")')

      expect(result).toBeDefined()
      expect(result.stdout).toBeDefined()
    })

    it('should allow configuring responses', async () => {
      mock.setResponse('print("hello")', {
        result: null,
        stdout: 'hello\n',
        stderr: '',
        duration: 1,
      })

      const result = await mock.exec('print("hello")')
      expect(result.stdout).toBe('hello\n')
    })

    it('should support pattern matching for responses', async () => {
      mock.setResponsePattern(/print\(.+\)/, {
        result: null,
        stdout: 'matched\n',
        stderr: '',
        duration: 1,
      })

      const result = await mock.exec('print("anything")')
      expect(result.stdout).toBe('matched\n')
    })
  })

  describe('call recording', () => {
    it('should record exec calls', async () => {
      await mock.exec('code1')
      await mock.exec('code2')

      const calls = mock.getCalls('exec')
      expect(calls).toHaveLength(2)
      expect(calls[0].args[0]).toBe('code1')
      expect(calls[1].args[0]).toBe('code2')
    })

    it('should record all method calls', async () => {
      await mock.exec('code')
      await mock.setGlobal('x', 1)
      await mock.getGlobal('x')

      const allCalls = mock.getAllCalls()
      expect(allCalls).toHaveLength(3)
    })

    it('should allow clearing recorded calls', () => {
      mock.exec('code')
      mock.clearCalls()

      expect(mock.getAllCalls()).toHaveLength(0)
    })

    it('should record call timestamps', async () => {
      await mock.exec('code')

      const calls = mock.getCalls('exec')
      expect(calls[0].timestamp).toBeInstanceOf(Date)
    })
  })

  describe('error simulation', () => {
    it('should simulate errors when configured', async () => {
      mock.setError('exec', new Error('Simulated error'))

      await expect(mock.exec('code')).rejects.toThrow('Simulated error')
    })

    it('should simulate errors for specific code', async () => {
      mock.setResponseError('bad_code()', new Error('Syntax error'))

      await expect(mock.exec('bad_code()')).rejects.toThrow('Syntax error')
    })
  })

  describe('implements PythonBackend', () => {
    it('should be usable as PythonBackend', () => {
      const backend: PythonBackend = mock
      expect(backend).toBeDefined()
    })

    it('should have all required methods', () => {
      expect(typeof mock.exec).toBe('function')
      expect(typeof mock.execWithGlobals).toBe('function')
      expect(typeof mock.importModule).toBe('function')
      expect(typeof mock.getGlobal).toBe('function')
      expect(typeof mock.setGlobal).toBe('function')
      expect(typeof mock.installPackage).toBe('function')
      expect(typeof mock.listPackages).toBe('function')
      expect(typeof mock.createSnapshot).toBe('function')
      expect(typeof mock.restoreSnapshot).toBe('function')
      expect(typeof mock.reset).toBe('function')
    })
  })
})

describe('ExecResult type', () => {
  it('should have required properties', () => {
    const result: ExecResult = {
      result: 42,
      stdout: 'output',
      stderr: '',
      duration: 100,
    }

    expect(result.result).toBe(42)
    expect(result.stdout).toBe('output')
    expect(result.stderr).toBe('')
    expect(result.duration).toBe(100)
  })
})

describe('Package type', () => {
  it('should have name and version', () => {
    const pkg: Package = {
      name: 'numpy',
      version: '1.24.0',
    }

    expect(pkg.name).toBe('numpy')
    expect(pkg.version).toBe('1.24.0')
  })
})
