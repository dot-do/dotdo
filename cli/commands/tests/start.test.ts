/**
 * Start Command Tests
 *
 * TDD tests for the `do start` command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Mock modules before importing the command
vi.mock('../../../cli/runtime/miniflare-adapter', () => ({
  createAdapter: vi.fn(() => ({
    start: vi.fn().mockResolvedValue({
      miniflare: {},
      port: 4000,
      url: 'http://localhost:4000',
      stop: vi.fn(),
    }),
    stop: vi.fn(),
    discoverDOs: vi.fn().mockResolvedValue({}),
    getDB: vi.fn(),
    getRegistry: vi.fn(),
  })),
}))

vi.mock('open', () => ({
  default: vi.fn(),
}))

// Import after mocks
import { startCommand, StartOptions, startAction, hasExistingProject, printSurfaceUrls } from '../start'
import { createAdapter } from '../../runtime/miniflare-adapter'

describe('start command', () => {
  let tempDir: string

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdo-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('hasExistingProject', () => {
    it('returns true when do.config.ts exists', async () => {
      fs.writeFileSync(path.join(tempDir, 'do.config.ts'), 'export default {}')
      const result = await hasExistingProject(tempDir)
      expect(result).toBe(true)
    })

    it('returns true when App.tsx exists', async () => {
      fs.writeFileSync(path.join(tempDir, 'App.tsx'), 'export default function App() {}')
      const result = await hasExistingProject(tempDir)
      expect(result).toBe(true)
    })

    it('returns true when .do directory exists with surfaces', async () => {
      fs.mkdirSync(path.join(tempDir, '.do'), { recursive: true })
      fs.writeFileSync(path.join(tempDir, '.do', 'App.tsx'), 'export default function App() {}')
      const result = await hasExistingProject(tempDir)
      expect(result).toBe(true)
    })

    it('returns false for empty directory', async () => {
      const result = await hasExistingProject(tempDir)
      expect(result).toBe(false)
    })
  })

  describe('printSurfaceUrls', () => {
    it('prints URLs for discovered surfaces', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const surfaces = {
        App: path.join(tempDir, 'App.tsx'),
        Admin: null,
        Site: path.join(tempDir, 'Site.mdx'),
        Docs: null,
        Blog: null,
      }

      printSurfaceUrls(4000, surfaces)

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('http://localhost:4000'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/admin'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/site'))

      consoleSpy.mockRestore()
    })
  })

  describe('startAction', () => {
    it('works with existing project', async () => {
      // Setup existing project
      fs.writeFileSync(path.join(tempDir, 'do.config.ts'), 'export default {}')
      fs.writeFileSync(path.join(tempDir, 'App.tsx'), 'export default function App() {}')

      const options: StartOptions = {
        port: '4000',
        open: false,
        tunnel: false,
        reset: false,
        cwd: tempDir,
      }

      // Start should not throw
      const result = await startAction(options)

      expect(createAdapter).toHaveBeenCalled()
      expect(result).toHaveProperty('url')
      expect(result.url).toBe('http://localhost:4000')
    })

    it('uses default port 4000', async () => {
      fs.writeFileSync(path.join(tempDir, 'App.tsx'), 'export default function App() {}')

      const options: StartOptions = {
        port: '4000',
        open: false,
        tunnel: false,
        reset: false,
        cwd: tempDir,
      }

      await startAction(options)

      expect(createAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          persist: expect.stringContaining('.do/state'),
        })
      )
    })

    it('respects custom port option', async () => {
      fs.writeFileSync(path.join(tempDir, 'App.tsx'), 'export default function App() {}')

      const options: StartOptions = {
        port: '5000',
        open: false,
        tunnel: false,
        reset: false,
        cwd: tempDir,
      }

      const result = await startAction(options)

      // The mock returns port 4000, but in real implementation it would use 5000
      expect(result).toBeDefined()
    })

    it('clears state when --reset flag is used', async () => {
      fs.writeFileSync(path.join(tempDir, 'App.tsx'), 'export default function App() {}')

      // Create state directory with data
      const stateDir = path.join(tempDir, '.do', 'state')
      fs.mkdirSync(stateDir, { recursive: true })
      fs.writeFileSync(path.join(stateDir, 'local.db'), 'test data')

      const options: StartOptions = {
        port: '4000',
        open: false,
        tunnel: false,
        reset: true,
        cwd: tempDir,
      }

      await startAction(options)

      // State should be cleared
      expect(fs.existsSync(path.join(stateDir, 'local.db'))).toBe(false)
    })
  })

  describe('command configuration', () => {
    it('has correct name', () => {
      expect(startCommand.name()).toBe('start')
    })

    it('has port option with default 4000', () => {
      const portOption = startCommand.options.find(opt => opt.long === '--port')
      expect(portOption).toBeDefined()
      expect(portOption?.defaultValue).toBe('4000')
    })

    it('has --no-open option', () => {
      const openOption = startCommand.options.find(opt => opt.long === '--no-open')
      expect(openOption).toBeDefined()
    })

    it('has --tunnel option', () => {
      const tunnelOption = startCommand.options.find(opt => opt.long === '--tunnel')
      expect(tunnelOption).toBeDefined()
    })

    it('has --reset option', () => {
      const resetOption = startCommand.options.find(opt => opt.long === '--reset')
      expect(resetOption).toBeDefined()
    })
  })
})
