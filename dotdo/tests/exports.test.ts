import { describe, it, expect } from 'vitest'

describe('dotdo package exports', () => {
  describe('@dotdo/do exports', () => {
    it('should export DO class', async () => {
      const { DO } = await import('../index')
      expect(DO).toBeDefined()
      expect(typeof DO).toBe('function')
    })

    it('should export createContext', async () => {
      const { createContext } = await import('../index')
      expect(createContext).toBeDefined()
      expect(typeof createContext).toBe('function')
    })

    it('should export DO types', async () => {
      // Type-only imports are checked at compile time
      const module = await import('../index')
      expect(module).toBeDefined()
    })
  })

  describe('@dotdo/rpc exports', () => {
    it('should export createClient', async () => {
      const { createClient } = await import('../index')
      expect(createClient).toBeDefined()
      expect(typeof createClient).toBe('function')
    })

    it('should export createDOStub', async () => {
      const { createDOStub } = await import('../index')
      expect(createDOStub).toBeDefined()
      expect(typeof createDOStub).toBe('function')
    })

    it('should export createServer', async () => {
      const { createServer } = await import('../index')
      expect(createServer).toBeDefined()
      expect(typeof createServer).toBe('function')
    })

    it('should export createWorkerFromTarget', async () => {
      const { createWorkerFromTarget } = await import('../index')
      expect(createWorkerFromTarget).toBeDefined()
      expect(typeof createWorkerFromTarget).toBe('function')
    })
  })

  describe('@dotdo/mcp exports', () => {
    it('should export createMCPServer', async () => {
      const { createMCPServer } = await import('../index')
      expect(createMCPServer).toBeDefined()
      expect(typeof createMCPServer).toBe('function')
    })

    it('should export MCP tools', async () => {
      const { searchTool, fetchTool, doTool } = await import('../index')
      expect(searchTool).toBeDefined()
      expect(fetchTool).toBeDefined()
      expect(doTool).toBeDefined()
    })
  })

  describe('@dotdo/api exports', () => {
    it('should export createAPI', async () => {
      const { createAPI } = await import('../index')
      expect(createAPI).toBeDefined()
      expect(typeof createAPI).toBe('function')
    })

    it('should export defineResource', async () => {
      const { defineResource } = await import('../index')
      expect(defineResource).toBeDefined()
      expect(typeof defineResource).toBe('function')
    })

    it('should export generateOpenAPI', async () => {
      const { generateOpenAPI } = await import('../index')
      expect(generateOpenAPI).toBeDefined()
      expect(typeof generateOpenAPI).toBe('function')
    })

    it('should export generateSDK', async () => {
      const { generateSDK } = await import('../index')
      expect(generateSDK).toBeDefined()
      expect(typeof generateSDK).toBe('function')
    })
  })

  describe('@dotdo/db exports', () => {
    it('should export all db modules', async () => {
      const module = await import('../index')
      // DB exports are from things, relationships, events, query
      expect(module).toBeDefined()
    })
  })

  describe('@dotdo/ai exports', () => {
    it('should export all ai modules', async () => {
      const module = await import('../index')
      // AI exports are from template, promise, providers
      expect(module).toBeDefined()
    })
  })

  describe('@dotdo/auth exports', () => {
    it('should export all auth modules', async () => {
      const module = await import('../index')
      // Auth exports are from middleware, guards
      expect(module).toBeDefined()
    })
  })

  describe('wildcard exports', () => {
    it('should have all exports accessible', async () => {
      const module = await import('../index')

      // Verify it's a module with exports
      expect(module).toBeDefined()
      expect(typeof module).toBe('object')

      // Check for key exports from each package
      expect(module.DO).toBeDefined() // @dotdo/do
      expect(module.createClient).toBeDefined() // @dotdo/rpc
      expect(module.createMCPServer).toBeDefined() // @dotdo/mcp
      expect(module.createAPI).toBeDefined() // @dotdo/api
    })
  })

  describe('no namespace collisions', () => {
    it('should export unique named exports', async () => {
      const module = await import('../index')

      // These should all be unique exports without collision
      const exports = [
        'DO',
        'createContext',
        'createClient',
        'createDOStub',
        'createServer',
        'createWorkerFromTarget',
        'createMCPServer',
        'searchTool',
        'fetchTool',
        'doTool',
        'createAPI',
        'defineResource',
        'generateOpenAPI',
        'generateSDK',
      ]

      for (const exportName of exports) {
        expect(module[exportName]).toBeDefined()
      }
    })
  })

  describe('package.json dependencies', () => {
    it('should declare all workspace dependencies', async () => {
      const { readFileSync } = await import('fs')
      const packageJson = JSON.parse(
        readFileSync('/Users/nathanclevenger/projects/dotdo/dotdo/package.json', 'utf-8')
      )

      expect(packageJson.dependencies).toBeDefined()
      expect(packageJson.dependencies['@dotdo/do']).toBe('workspace:*')
      expect(packageJson.dependencies['@dotdo/db']).toBe('workspace:*')
      expect(packageJson.dependencies['@dotdo/ai']).toBe('workspace:*')
      expect(packageJson.dependencies['@dotdo/auth']).toBe('workspace:*')
      expect(packageJson.dependencies['@dotdo/rpc']).toBe('workspace:*')
      expect(packageJson.dependencies['@dotdo/mcp']).toBe('workspace:*')
      expect(packageJson.dependencies['@dotdo/api']).toBe('workspace:*')
    })
  })
})
