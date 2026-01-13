/**
 * Browser Utility Tests
 *
 * Tests for the cross-platform browser opening functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openBrowser, isBrowserAvailable, type BrowserOptions, type BrowserResult } from '../utils/browser'
import { exec } from 'child_process'
import { platform } from 'os'

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

// Mock os.platform
vi.mock('os', () => ({
  platform: vi.fn(),
}))

const mockExec = exec as unknown as ReturnType<typeof vi.fn>
const mockPlatform = platform as unknown as ReturnType<typeof vi.fn>

describe('Browser Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default to macOS
    mockPlatform.mockReturnValue('darwin')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openBrowser', () => {
    it('opens URL in default browser on macOS', async () => {
      mockPlatform.mockReturnValue('darwin')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const result = await openBrowser('https://example.com')

      expect(result.success).toBe(true)
      expect(result.url).toBe('https://example.com')
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('open'),
        expect.any(Function)
      )
    })

    it('opens URL in default browser on Windows', async () => {
      mockPlatform.mockReturnValue('win32')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const result = await openBrowser('https://example.com')

      expect(result.success).toBe(true)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('start'),
        expect.any(Function)
      )
    })

    it('opens URL in default browser on Linux', async () => {
      mockPlatform.mockReturnValue('linux')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const result = await openBrowser('https://example.com')

      expect(result.success).toBe(true)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('xdg-open'),
        expect.any(Function)
      )
    })

    it('opens URL in specific browser on macOS', async () => {
      mockPlatform.mockReturnValue('darwin')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const result = await openBrowser('https://example.com', { browser: 'chrome' })

      expect(result.success).toBe(true)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('Google Chrome'),
        expect.any(Function)
      )
    })

    it('opens URL in specific browser on Linux', async () => {
      mockPlatform.mockReturnValue('linux')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const result = await openBrowser('https://example.com', { browser: 'chrome' })

      expect(result.success).toBe(true)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('google-chrome'),
        expect.any(Function)
      )
    })

    it('returns error when browser fails to open', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(new Error('Failed to open browser'))
      })

      const result = await openBrowser('https://example.com')

      expect(result.success).toBe(false)
      expect(result.url).toBe('https://example.com')
      expect(result.error).toBe('Failed to open browser')
    })

    it('properly escapes URLs with special characters', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const url = 'https://example.com/path?query=value&other=test'
      const result = await openBrowser(url)

      expect(result.success).toBe(true)
      expect(result.url).toBe(url)
    })

    it('handles OAuth callback URLs', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const url = 'https://github.com/login/oauth/authorize?client_id=test&scope=user:email+repo&state=abc123'
      const result = await openBrowser(url)

      expect(result.success).toBe(true)
      expect(result.url).toBe(url)
    })
  })

  describe('isBrowserAvailable', () => {
    it('returns true when browser is available', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const available = await isBrowserAvailable()

      expect(available).toBe(true)
    })

    it('returns false when browser is not available', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(new Error('not found'))
      })

      const available = await isBrowserAvailable()

      expect(available).toBe(false)
    })

    it('checks specific browser availability', async () => {
      mockPlatform.mockReturnValue('darwin')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const available = await isBrowserAvailable('chrome')

      expect(available).toBe(true)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('which'),
        expect.any(Function)
      )
    })

    it('uses where command on Windows', async () => {
      mockPlatform.mockReturnValue('win32')
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      await isBrowserAvailable()

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('where'),
        expect.any(Function)
      )
    })
  })

  describe('BrowserOptions', () => {
    it('accepts browser option', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const options: BrowserOptions = { browser: 'firefox' }
      const result = await openBrowser('https://example.com', options)

      expect(result.success).toBe(true)
    })

    it('accepts args option', async () => {
      mockExec.mockImplementation((cmd: string, callback: (error: Error | null) => void) => {
        callback(null)
      })

      const options: BrowserOptions = { args: ['--incognito'] }
      const result = await openBrowser('https://example.com', options)

      expect(result.success).toBe(true)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--incognito'),
        expect.any(Function)
      )
    })
  })
})
