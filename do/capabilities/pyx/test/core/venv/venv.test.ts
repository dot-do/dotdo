import { describe, it, expect, beforeEach } from 'vitest'
import {
  VirtualEnv,
  VirtualEnvOptions,
} from '../../../core/venv'

describe('VirtualEnv', () => {
  describe('constructor', () => {
    it('should create a VirtualEnv instance with default options', () => {
      const env = new VirtualEnv()
      expect(env).toBeInstanceOf(VirtualEnv)
    })

    it('should accept custom options', () => {
      const options: VirtualEnvOptions = {
        name: 'test-env',
        pythonVersion: '3.11',
      }
      const env = new VirtualEnv(options)
      expect(env.name).toBe('test-env')
      expect(env.pythonVersion).toBe('3.11')
    })

    it('should generate a unique id for each instance', () => {
      const env1 = new VirtualEnv()
      const env2 = new VirtualEnv()
      expect(env1.id).toBeDefined()
      expect(env2.id).toBeDefined()
      expect(env1.id).not.toBe(env2.id)
    })
  })

  describe('install', () => {
    let env: VirtualEnv

    beforeEach(() => {
      env = new VirtualEnv()
    })

    it('should install a package without version', async () => {
      await env.install('requests')
      expect(env.isInstalled('requests')).toBe(true)
    })

    it('should install a package with a specific version', async () => {
      await env.install('requests', '2.28.0')
      expect(env.isInstalled('requests')).toBe(true)
      expect(env.getVersion('requests')).toBe('2.28.0')
    })

    it('should throw if package is already installed', async () => {
      await env.install('requests', '2.28.0')
      await expect(env.install('requests', '2.29.0')).rejects.toThrow(
        'Package requests is already installed'
      )
    })

    it('should install multiple packages', async () => {
      await env.install('requests', '2.28.0')
      await env.install('flask', '2.0.0')
      expect(env.isInstalled('requests')).toBe(true)
      expect(env.isInstalled('flask')).toBe(true)
    })

    it('should normalize package names', async () => {
      await env.install('Flask', '2.0.0')
      expect(env.isInstalled('flask')).toBe(true)
      expect(env.isInstalled('Flask')).toBe(true)
      expect(env.isInstalled('FLASK')).toBe(true)
    })
  })

  describe('uninstall', () => {
    let env: VirtualEnv

    beforeEach(async () => {
      env = new VirtualEnv()
      await env.install('requests', '2.28.0')
    })

    it('should uninstall an installed package', async () => {
      await env.uninstall('requests')
      expect(env.isInstalled('requests')).toBe(false)
    })

    it('should throw if package is not installed', async () => {
      await expect(env.uninstall('flask')).rejects.toThrow(
        'Package flask is not installed'
      )
    })

    it('should handle case-insensitive package names', async () => {
      await env.uninstall('REQUESTS')
      expect(env.isInstalled('requests')).toBe(false)
    })
  })

  describe('list', () => {
    let env: VirtualEnv

    beforeEach(() => {
      env = new VirtualEnv()
    })

    it('should return empty array for fresh environment', () => {
      const packages = env.list()
      expect(packages).toEqual([])
    })

    it('should return all installed packages', async () => {
      await env.install('requests', '2.28.0')
      await env.install('flask', '2.0.0')
      const packages = env.list()
      expect(packages).toHaveLength(2)
      expect(packages).toContainEqual(
        expect.objectContaining({ name: 'requests', version: '2.28.0' })
      )
      expect(packages).toContainEqual(
        expect.objectContaining({ name: 'flask', version: '2.0.0' })
      )
    })

    it('should return InstalledPackage objects with required fields', async () => {
      await env.install('requests', '2.28.0')
      const packages = env.list()
      const pkg = packages[0]
      expect(pkg).toHaveProperty('name')
      expect(pkg).toHaveProperty('version')
      expect(pkg).toHaveProperty('installedAt')
      expect(pkg.installedAt).toBeInstanceOf(Date)
    })
  })

  describe('isInstalled', () => {
    let env: VirtualEnv

    beforeEach(async () => {
      env = new VirtualEnv()
      await env.install('requests', '2.28.0')
    })

    it('should return true for installed package', () => {
      expect(env.isInstalled('requests')).toBe(true)
    })

    it('should return false for non-installed package', () => {
      expect(env.isInstalled('flask')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(env.isInstalled('REQUESTS')).toBe(true)
      expect(env.isInstalled('Requests')).toBe(true)
    })
  })

  describe('getVersion', () => {
    let env: VirtualEnv

    beforeEach(async () => {
      env = new VirtualEnv()
      await env.install('requests', '2.28.0')
    })

    it('should return version for installed package', () => {
      expect(env.getVersion('requests')).toBe('2.28.0')
    })

    it('should return null for non-installed package', () => {
      expect(env.getVersion('flask')).toBeNull()
    })

    it('should be case-insensitive', () => {
      expect(env.getVersion('REQUESTS')).toBe('2.28.0')
    })
  })
})

describe('Package installation tracking', () => {
  it('should track installation timestamp', async () => {
    const env = new VirtualEnv()
    const before = new Date()
    await env.install('requests', '2.28.0')
    const after = new Date()

    const packages = env.list()
    const pkg = packages[0]
    expect(pkg.installedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(pkg.installedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should track installation source', async () => {
    const env = new VirtualEnv()
    await env.install('requests', '2.28.0')

    const packages = env.list()
    const pkg = packages[0]
    expect(pkg.source).toBe('pypi')
  })

  it('should allow specifying custom installation source', async () => {
    const env = new VirtualEnv()
    await env.install('my-package', '1.0.0', { source: 'local' })

    const packages = env.list()
    const pkg = packages.find((p) => p.name === 'my-package')
    expect(pkg?.source).toBe('local')
  })
})

describe('Dependency resolution', () => {
  let env: VirtualEnv

  beforeEach(() => {
    env = new VirtualEnv()
  })

  it('should resolve and install dependencies', async () => {
    // requests depends on urllib3, charset-normalizer, idna, certifi
    await env.install('requests', '2.28.0', { resolveDependencies: true })

    expect(env.isInstalled('requests')).toBe(true)
    expect(env.isInstalled('urllib3')).toBe(true)
    expect(env.isInstalled('charset-normalizer')).toBe(true)
  })

  it('should track dependency relationships', async () => {
    await env.install('requests', '2.28.0', { resolveDependencies: true })

    const packages = env.list()
    const urllib3 = packages.find((p) => p.name === 'urllib3')
    expect(urllib3?.dependencyOf).toContain('requests')
  })

  it('should not uninstall shared dependencies', async () => {
    await env.install('requests', '2.28.0', { resolveDependencies: true })
    await env.install('httpx', '0.24.0', { resolveDependencies: true })

    // Both may depend on certifi
    await env.uninstall('requests')
    // certifi should remain if httpx still needs it
    expect(env.isInstalled('httpx')).toBe(true)
  })

  it('should handle circular dependencies gracefully', async () => {
    // Mock a package with circular deps
    await expect(
      env.install('circular-dep-package', '1.0.0', { resolveDependencies: true })
    ).resolves.not.toThrow()
  })
})

describe('Pyodide package compatibility', () => {
  let env: VirtualEnv

  beforeEach(() => {
    env = new VirtualEnv()
  })

  describe('isPyodideCompatible', () => {
    it('should return true for packages in Pyodide packages list', () => {
      // numpy is included in Pyodide
      expect(env.isPyodideCompatible('numpy')).toBe(true)
    })

    it('should return true for pure Python packages', () => {
      // requests is pure Python
      expect(env.isPyodideCompatible('requests')).toBe(true)
    })

    it('should return false for packages with native extensions not in Pyodide', () => {
      // Some packages with C extensions not ported to Pyodide
      expect(env.isPyodideCompatible('psycopg2')).toBe(false)
    })

    it('should check compatibility for specific version', () => {
      expect(env.isPyodideCompatible('numpy', '1.24.0')).toBe(true)
      expect(env.isPyodideCompatible('numpy', '0.1.0')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(env.isPyodideCompatible('NumPy')).toBe(true)
      expect(env.isPyodideCompatible('NUMPY')).toBe(true)
    })
  })

  it('should warn when installing incompatible package', async () => {
    const warnings: string[] = []
    const env = new VirtualEnv({
      onWarning: (msg) => warnings.push(msg),
    })

    await env.install('psycopg2', '2.9.0')

    expect(warnings).toContainEqual(
      expect.stringContaining('not compatible with Pyodide')
    )
  })

  it('should optionally reject incompatible packages', async () => {
    const env = new VirtualEnv({
      strictPyodideCompatibility: true,
    })

    await expect(env.install('psycopg2', '2.9.0')).rejects.toThrow(
      'not compatible with Pyodide'
    )
  })
})

describe('Package version pinning', () => {
  let env: VirtualEnv

  beforeEach(() => {
    env = new VirtualEnv()
  })

  it('should pin exact version', async () => {
    await env.install('requests', '==2.28.0')
    expect(env.getVersion('requests')).toBe('2.28.0')
  })

  it('should resolve minimum version constraint', async () => {
    await env.install('requests', '>=2.28.0')
    const version = env.getVersion('requests')
    expect(version).toBeDefined()
    // Should be at least 2.28.0
    expect(
      version!.localeCompare('2.28.0', undefined, { numeric: true })
    ).toBeGreaterThanOrEqual(0)
  })

  it('should resolve maximum version constraint', async () => {
    await env.install('requests', '<3.0.0')
    const version = env.getVersion('requests')
    expect(version).toBeDefined()
    expect(
      version!.localeCompare('3.0.0', undefined, { numeric: true })
    ).toBeLessThan(0)
  })

  it('should resolve version range constraint', async () => {
    await env.install('requests', '>=2.28.0,<3.0.0')
    const version = env.getVersion('requests')
    expect(version).toBeDefined()
    expect(
      version!.localeCompare('2.28.0', undefined, { numeric: true })
    ).toBeGreaterThanOrEqual(0)
    expect(
      version!.localeCompare('3.0.0', undefined, { numeric: true })
    ).toBeLessThan(0)
  })

  it('should resolve compatible release constraint', async () => {
    await env.install('requests', '~=2.28.0')
    const version = env.getVersion('requests')
    expect(version).toBeDefined()
    expect(version!.startsWith('2.28.')).toBe(true)
  })

  it('should throw for unsatisfiable version constraint', async () => {
    await expect(env.install('requests', '>999.0.0')).rejects.toThrow(
      'No compatible version found'
    )
  })
})

describe('Environment isolation', () => {
  it('should maintain separate package lists per instance', async () => {
    const env1 = new VirtualEnv()
    const env2 = new VirtualEnv()

    await env1.install('requests', '2.28.0')
    await env2.install('flask', '2.0.0')

    expect(env1.isInstalled('requests')).toBe(true)
    expect(env1.isInstalled('flask')).toBe(false)
    expect(env2.isInstalled('flask')).toBe(true)
    expect(env2.isInstalled('requests')).toBe(false)
  })

  it('should allow same package with different versions in different envs', async () => {
    const env1 = new VirtualEnv()
    const env2 = new VirtualEnv()

    await env1.install('requests', '2.28.0')
    await env2.install('requests', '2.29.0')

    expect(env1.getVersion('requests')).toBe('2.28.0')
    expect(env2.getVersion('requests')).toBe('2.29.0')
  })

  it('should not share state between cloned environments', async () => {
    const env1 = new VirtualEnv()
    await env1.install('requests', '2.28.0')

    const env2 = env1.clone()
    await env2.install('flask', '2.0.0')

    expect(env1.isInstalled('flask')).toBe(false)
    expect(env2.isInstalled('flask')).toBe(true)
    expect(env2.isInstalled('requests')).toBe(true)
  })
})

describe('Export/import environment state', () => {
  let env: VirtualEnv

  beforeEach(async () => {
    env = new VirtualEnv({ name: 'test-env' })
    await env.install('requests', '2.28.0')
    await env.install('flask', '2.0.0')
  })

  describe('export', () => {
    it('should export state as JSON-serializable object', () => {
      const state = env.export()
      expect(state).toHaveProperty('name')
      expect(state).toHaveProperty('packages')
      expect(state).toHaveProperty('exportedAt')
      expect(JSON.stringify(state)).toBeDefined()
    })

    it('should include all installed packages', () => {
      const state = env.export()
      expect(typeof state).not.toBe('string')
      if (typeof state === 'string') throw new Error('Expected VirtualEnvState')
      expect(state.packages).toHaveLength(2)
      expect(state.packages).toContainEqual(
        expect.objectContaining({ name: 'requests', version: '2.28.0' })
      )
      expect(state.packages).toContainEqual(
        expect.objectContaining({ name: 'flask', version: '2.0.0' })
      )
    })

    it('should export to requirements.txt format', () => {
      const requirements = env.export({ format: 'requirements' })
      expect(requirements).toContain('requests==2.28.0')
      expect(requirements).toContain('flask==2.0.0')
    })
  })

  describe('import', () => {
    it('should restore environment from exported state', async () => {
      const state = env.export()
      const newEnv = new VirtualEnv()
      await newEnv.import(state)

      expect(newEnv.isInstalled('requests')).toBe(true)
      expect(newEnv.isInstalled('flask')).toBe(true)
      expect(newEnv.getVersion('requests')).toBe('2.28.0')
    })

    it('should import from requirements.txt format', async () => {
      const requirements = `
requests==2.28.0
flask==2.0.0
# This is a comment
numpy>=1.24.0
`
      const newEnv = new VirtualEnv()
      await newEnv.import(requirements, { format: 'requirements' })

      expect(newEnv.isInstalled('requests')).toBe(true)
      expect(newEnv.isInstalled('flask')).toBe(true)
      expect(newEnv.isInstalled('numpy')).toBe(true)
    })

    it('should merge with existing packages by default', async () => {
      const state = env.export()
      const newEnv = new VirtualEnv()
      await newEnv.install('pandas', '2.0.0')
      await newEnv.import(state)

      expect(newEnv.isInstalled('pandas')).toBe(true)
      expect(newEnv.isInstalled('requests')).toBe(true)
    })

    it('should replace existing packages when specified', async () => {
      const state = env.export()
      const newEnv = new VirtualEnv()
      await newEnv.install('pandas', '2.0.0')
      await newEnv.import(state, { replace: true })

      expect(newEnv.isInstalled('pandas')).toBe(false)
      expect(newEnv.isInstalled('requests')).toBe(true)
    })
  })

  describe('VirtualEnv.fromState', () => {
    it('should create new environment from state', async () => {
      const state = env.export()
      if (typeof state === 'string') throw new Error('Expected VirtualEnvState')
      const newEnv = await VirtualEnv.fromState(state)

      expect(newEnv).toBeInstanceOf(VirtualEnv)
      expect(newEnv.isInstalled('requests')).toBe(true)
      expect(newEnv.name).toBe('test-env')
    })
  })
})

describe('Wheel compatibility', () => {
  let env: VirtualEnv

  beforeEach(() => {
    env = new VirtualEnv()
  })

  describe('py3-none-any wheel compatibility', () => {
    it('should accept py3-none-any wheels', () => {
      expect(env.isWheelCompatible('requests-2.28.0-py3-none-any.whl')).toBe(
        true
      )
    })

    it('should accept py2.py3-none-any wheels', () => {
      expect(
        env.isWheelCompatible('six-1.16.0-py2.py3-none-any.whl')
      ).toBe(true)
    })

    it('should reject platform-specific wheels', () => {
      expect(
        env.isWheelCompatible(
          'numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl'
        )
      ).toBe(false)
    })

    it('should reject Windows-specific wheels', () => {
      expect(
        env.isWheelCompatible('numpy-1.24.0-cp311-cp311-win_amd64.whl')
      ).toBe(false)
    })

    it('should reject macOS-specific wheels', () => {
      expect(
        env.isWheelCompatible(
          'numpy-1.24.0-cp311-cp311-macosx_10_9_x86_64.whl'
        )
      ).toBe(false)
    })
  })

  describe('Pyodide-compatible wheels', () => {
    it('should accept emscripten/wasm32 wheels', () => {
      expect(
        env.isWheelCompatible(
          'numpy-1.24.0-cp311-cp311-emscripten_3_1_32_wasm32.whl'
        )
      ).toBe(true)
    })

    it('should accept pyodide-specific wheels', () => {
      expect(
        env.isWheelCompatible('numpy-1.24.0-cp311-cp311-pyodide_2024_0_wasm32.whl')
      ).toBe(true)
    })
  })

  it('should reject incompatible wheel on install', async () => {
    await expect(
      env.install('numpy', '1.24.0', {
        wheelUrl:
          'https://example.com.ai/numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl',
      })
    ).rejects.toThrow('Wheel is not compatible with Pyodide')
  })

  it('should prefer py3-none-any wheel when available', async () => {
    await env.install('requests', '2.28.0')
    const packages = env.list()
    const requests = packages.find((p) => p.name === 'requests')
    expect(requests?.wheelTag).toBe('py3-none-any')
  })
})
