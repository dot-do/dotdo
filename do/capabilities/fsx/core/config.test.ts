/**
 * Tests for FSx Configuration
 * RED phase: These tests should fail until configuration is implemented
 */

import { describe, expect, it } from 'vitest'

describe('FSxConfig', () => {
  describe('Default Configuration', () => {
    it('should have valid defaults when created with no options', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig()

      expect(config).toBeDefined()
      expect(config.rootPath).toBe('/')
      expect(config.readOnly).toBe(false)
      expect(config.encoding).toBe('utf8')
      expect(config.mode).toBe(0o666)
      expect(config.recursive).toBe(false)
    })

    it('should have flags default to O_RDONLY', async () => {
      const { createConfig } = await import('./config')
      const { constants } = await import('./constants')

      const config = createConfig()

      expect(config.flags).toBe(constants.O_RDONLY)
    })
  })

  describe('Custom Configuration', () => {
    it('should accept custom rootPath', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ rootPath: '/home/user' })

      expect(config.rootPath).toBe('/home/user')
    })

    it('should normalize custom rootPath', async () => {
      const { createConfig } = await import('./config')

      // Multiple slashes should be collapsed
      const config1 = createConfig({ rootPath: '/foo//bar' })
      expect(config1.rootPath).toBe('/foo/bar')

      // Trailing slashes should be removed
      const config2 = createConfig({ rootPath: '/foo/bar/' })
      expect(config2.rootPath).toBe('/foo/bar')

      // Dot segments should be resolved
      const config3 = createConfig({ rootPath: '/foo/./bar/../baz' })
      expect(config3.rootPath).toBe('/foo/baz')

      // Relative path should be made absolute
      const config4 = createConfig({ rootPath: 'foo/bar' })
      expect(config4.rootPath).toBe('/foo/bar')
    })

    it('should accept custom readOnly flag', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ readOnly: true })

      expect(config.readOnly).toBe(true)
    })

    it('should accept custom encoding', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ encoding: 'ascii' })

      expect(config.encoding).toBe('ascii')
    })

    it('should accept custom mode', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ mode: 0o755 })

      expect(config.mode).toBe(0o755)
    })

    it('should accept custom flags', async () => {
      const { createConfig } = await import('./config')
      const { constants } = await import('./constants')

      const config = createConfig({ flags: constants.O_RDWR | constants.O_CREAT })

      expect(config.flags).toBe(constants.O_RDWR | constants.O_CREAT)
    })

    it('should accept custom recursive option', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ recursive: true })

      expect(config.recursive).toBe(true)
    })

    it('should preserve default values for unspecified options', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ rootPath: '/custom' })

      // Custom value
      expect(config.rootPath).toBe('/custom')
      // Default values preserved
      expect(config.readOnly).toBe(false)
      expect(config.encoding).toBe('utf8')
      expect(config.mode).toBe(0o666)
      expect(config.recursive).toBe(false)
    })
  })

  describe('Validation', () => {
    it('should throw EINVAL for invalid mode (negative)', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      expect(() => createConfig({ mode: -1 })).toThrow(EINVAL)
    })

    it('should throw EINVAL for invalid mode (exceeds max)', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // Mode should be at most 0o7777 (4095 in decimal)
      expect(() => createConfig({ mode: 0o10000 })).toThrow(EINVAL)
    })

    it('should throw EINVAL for invalid encoding', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // @ts-expect-error - Testing invalid encoding
      expect(() => createConfig({ encoding: 'invalid-encoding' })).toThrow(EINVAL)
    })

    it('should throw EINVAL for non-string rootPath', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // @ts-expect-error - Testing invalid rootPath
      expect(() => createConfig({ rootPath: 123 })).toThrow(EINVAL)
    })

    it('should throw EINVAL for non-boolean readOnly', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // @ts-expect-error - Testing invalid readOnly
      expect(() => createConfig({ readOnly: 'true' })).toThrow(EINVAL)
    })

    it('should throw EINVAL for non-number mode', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // @ts-expect-error - Testing invalid mode
      expect(() => createConfig({ mode: '644' })).toThrow(EINVAL)
    })

    it('should throw EINVAL for non-number flags', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // @ts-expect-error - Testing invalid flags
      expect(() => createConfig({ flags: 'r' })).toThrow(EINVAL)
    })

    it('should throw EINVAL for non-boolean recursive', async () => {
      const { createConfig } = await import('./config')
      const { EINVAL } = await import('./errors')

      // @ts-expect-error - Testing invalid recursive
      expect(() => createConfig({ recursive: 1 })).toThrow(EINVAL)
    })
  })

  describe('Immutability', () => {
    it('should return a frozen configuration object', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig()

      expect(Object.isFrozen(config)).toBe(true)
    })

    it('should not allow modification of properties', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig()

      // Attempt to modify should fail silently in non-strict mode
      // or throw in strict mode
      expect(() => {
        // @ts-expect-error - Testing immutability
        config.rootPath = '/modified'
      }).toThrow()
    })

    it('should not allow adding new properties', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig()

      expect(() => {
        // @ts-expect-error - Testing immutability
        config.newProp = 'value'
      }).toThrow()
    })
  })

  describe('Read-Only Mode Behavior', () => {
    it('should create config with readOnly=true', async () => {
      const { createConfig } = await import('./config')

      const config = createConfig({ readOnly: true })

      expect(config.readOnly).toBe(true)
    })

    it('should have isReadOnly helper that returns readOnly value', async () => {
      const { createConfig, isReadOnly } = await import('./config')

      const rwConfig = createConfig({ readOnly: false })
      const roConfig = createConfig({ readOnly: true })

      expect(isReadOnly(rwConfig)).toBe(false)
      expect(isReadOnly(roConfig)).toBe(true)
    })
  })
})

describe('FSxConfig Type', () => {
  it('should export FSxConfig type', async () => {
    const configModule = await import('./config')

    // This test ensures the type is exported
    // TypeScript will fail compilation if type isn't exported
    type Config = typeof configModule.defaultConfig
    const config: Config = configModule.defaultConfig

    expect(config).toBeDefined()
  })
})

describe('Valid Encodings', () => {
  it('should accept utf8 encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'utf8' })).not.toThrow()
  })

  it('should accept utf-8 encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'utf-8' })).not.toThrow()
  })

  it('should accept ascii encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'ascii' })).not.toThrow()
  })

  it('should accept base64 encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'base64' })).not.toThrow()
  })

  it('should accept hex encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'hex' })).not.toThrow()
  })

  it('should accept binary encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'binary' })).not.toThrow()
  })

  it('should accept latin1 encoding', async () => {
    const { createConfig } = await import('./config')
    expect(() => createConfig({ encoding: 'latin1' })).not.toThrow()
  })
})

describe('Edge Cases', () => {
  it('should handle empty options object', async () => {
    const { createConfig, defaultConfig } = await import('./config')

    const config = createConfig({})

    expect(config.rootPath).toBe(defaultConfig.rootPath)
    expect(config.readOnly).toBe(defaultConfig.readOnly)
    expect(config.encoding).toBe(defaultConfig.encoding)
    expect(config.mode).toBe(defaultConfig.mode)
    expect(config.flags).toBe(defaultConfig.flags)
    expect(config.recursive).toBe(defaultConfig.recursive)
  })

  it('should handle root path correctly', async () => {
    const { createConfig } = await import('./config')

    const config = createConfig({ rootPath: '/' })

    expect(config.rootPath).toBe('/')
  })

  it('should handle mode 0 (no permissions)', async () => {
    const { createConfig } = await import('./config')

    const config = createConfig({ mode: 0 })

    expect(config.mode).toBe(0)
  })

  it('should handle max valid mode 0o7777', async () => {
    const { createConfig } = await import('./config')

    const config = createConfig({ mode: 0o7777 })

    expect(config.mode).toBe(0o7777)
  })

  it('should handle empty string rootPath by using default', async () => {
    const { createConfig } = await import('./config')

    // Empty string should be treated as current directory
    // which normalizes to root
    const config = createConfig({ rootPath: '' })

    expect(config.rootPath).toBe('/')
  })
})
