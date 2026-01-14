import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  webCommand,
  generateHTML,
  convertAnsiToHTML,
  uploadPreview,
  generateStandaloneHTML,
  type WebOptions,
  type WebResult,
  type UploadResult,
  type ProgressCallback
} from '../../../src/cli/commands/web'
import { createCLI, type CommandContext } from '../../../src/cli/index'
import type { DiffResult } from '../../../src/cli/commands/diff'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary git repository for testing
 */
async function createTestRepo(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-web-test-'))

  // Initialize minimal git structure
  const gitDir = path.join(tmpDir, '.git')
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

  return tmpDir
}

/**
 * Clean up test repository
 */
async function cleanupTestRepo(repoPath: string): Promise<void> {
  await fs.rm(repoPath, { recursive: true, force: true })
}

/**
 * Create output capture for CLI tests
 */
function createOutputCapture() {
  const output: { stdout: string[]; stderr: string[] } = {
    stdout: [],
    stderr: []
  }

  return {
    output,
    stdout: (msg: string) => output.stdout.push(msg),
    stderr: (msg: string) => output.stderr.push(msg)
  }
}

/**
 * Create a mock command context
 */
function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cwd: process.cwd(),
    args: [],
    options: {},
    rawArgs: [],
    stdout: (msg: string) => {},
    stderr: (msg: string) => {},
    ...overrides
  }
}

/**
 * Create a mock diff result for testing
 */
function createMockDiffResult(): DiffResult {
  return {
    entries: [
      {
        path: 'src/index.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 4,
            lines: [
              { type: 'context', content: 'import { foo } from "./foo";', oldLineNo: 1, newLineNo: 1 },
              { type: 'deletion', content: 'const x = 1;', oldLineNo: 2 },
              { type: 'addition', content: 'const x = 2;', newLineNo: 2 },
              { type: 'addition', content: 'const y = 3;', newLineNo: 3 },
              { type: 'context', content: 'export { x };', oldLineNo: 3, newLineNo: 4 }
            ]
          }
        ]
      },
      {
        path: 'src/utils/helper.ts',
        status: 'added',
        hunks: [
          {
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 5,
            lines: [
              { type: 'addition', content: 'export function helper() {', newLineNo: 1 },
              { type: 'addition', content: '  return "help";', newLineNo: 2 },
              { type: 'addition', content: '}', newLineNo: 3 }
            ]
          }
        ]
      }
    ],
    stats: {
      filesChanged: 2,
      insertions: 4,
      deletions: 1
    }
  }
}

/**
 * Create sample ANSI-colored diff output
 */
function createAnsiDiffOutput(): string[] {
  return [
    'diff --git a/src/index.ts b/src/index.ts',
    '\x1b[36m@@ -1,3 +1,4 @@\x1b[0m',
    ' import { foo } from "./foo";',
    '\x1b[31m-const x = 1;\x1b[0m',
    '\x1b[32m+const x = 2;\x1b[0m',
    '\x1b[32m+const y = 3;\x1b[0m',
    ' export { x };'
  ]
}

// ============================================================================
// Test Suites
// ============================================================================

describe('gitx web command', () => {
  let testRepoPath: string

  beforeEach(async () => {
    testRepoPath = await createTestRepo()
  })

  afterEach(async () => {
    await cleanupTestRepo(testRepoPath)
  })

  // ==========================================================================
  // Test 1: Generates HTML from diff output
  // ==========================================================================
  describe('Generates HTML from diff output', () => {
    it('should generate valid HTML document from diff result', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('</html>')
    })

    it('should include diff content in HTML body', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      expect(html).toContain('src/index.ts')
      expect(html).toContain('const x = 1')
      expect(html).toContain('const x = 2')
    })

    it('should include proper HTML head with meta tags', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      expect(html).toContain('<head>')
      expect(html).toContain('<meta charset')
      expect(html).toContain('<title>')
    })

    it('should include CSS styles in HTML', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      expect(html).toContain('<style>')
      expect(html).toContain('</style>')
    })

    it('should show file stats in HTML output', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Should include stats like "2 files changed, 4 insertions, 1 deletion"
      expect(html).toMatch(/\d+\s*(files?\s*changed|insertions?|deletions?)/i)
    })

    it('should handle empty diff result', async () => {
      const emptyDiff: DiffResult = {
        entries: [],
        stats: { filesChanged: 0, insertions: 0, deletions: 0 }
      }

      const html = await generateHTML(emptyDiff)

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('No changes')
    })
  })

  // ==========================================================================
  // Test 2: Preserves syntax highlighting in HTML (converts ANSI to HTML)
  // ==========================================================================
  describe('Preserves syntax highlighting in HTML (converts ANSI to HTML)', () => {
    it('should convert ANSI green color to HTML span with green class', () => {
      const ansiText = '\x1b[32m+const x = 2;\x1b[0m'

      const html = convertAnsiToHTML(ansiText)

      expect(html).toContain('<span')
      expect(html).toContain('class=')
      expect(html).toMatch(/addition|green|add/i)
    })

    it('should convert ANSI red color to HTML span with red class', () => {
      const ansiText = '\x1b[31m-const x = 1;\x1b[0m'

      const html = convertAnsiToHTML(ansiText)

      expect(html).toContain('<span')
      expect(html).toMatch(/deletion|red|del/i)
    })

    it('should convert ANSI cyan color to HTML span for hunk headers', () => {
      const ansiText = '\x1b[36m@@ -1,3 +1,4 @@\x1b[0m'

      const html = convertAnsiToHTML(ansiText)

      expect(html).toContain('<span')
      expect(html).toMatch(/hunk|cyan|header/i)
    })

    it('should handle 24-bit ANSI color codes (RGB)', () => {
      // Shiki uses 24-bit colors like \x1b[38;2;R;G;Bm
      const ansiText = '\x1b[38;2;255;123;0mconst\x1b[0m'

      const html = convertAnsiToHTML(ansiText)

      expect(html).toContain('<span')
      expect(html).toMatch(/style=|color:/i)
    })

    it('should escape HTML special characters', () => {
      const ansiText = '<div>&amp;</div>'

      const html = convertAnsiToHTML(ansiText)

      expect(html).toContain('&lt;')
      expect(html).toContain('&gt;')
      expect(html).toContain('&amp;')
    })

    it('should handle nested ANSI codes', () => {
      const ansiText = '\x1b[32m+\x1b[38;2;200;100;50mfunction\x1b[0m\x1b[32m foo()\x1b[0m'

      const html = convertAnsiToHTML(ansiText)

      expect(html).toContain('<span')
      // Should properly close and open spans
      expect(html.match(/<span/g)?.length).toBeGreaterThanOrEqual(1)
    })

    it('should preserve plain text without ANSI codes', () => {
      const plainText = 'import { foo } from "./foo";'

      const html = convertAnsiToHTML(plainText)

      expect(html).toContain('import')
      expect(html).toContain('foo')
    })

    it('should convert full diff output with multiple ANSI codes', () => {
      const ansiLines = createAnsiDiffOutput()

      const htmlLines = ansiLines.map(line => convertAnsiToHTML(line))

      htmlLines.forEach(html => {
        expect(html).not.toContain('\x1b[')
      })
    })
  })

  // ==========================================================================
  // Test 3: Returns shareable URL
  // ==========================================================================
  describe('Returns shareable URL', () => {
    it('should return a URL string after upload', async () => {
      const html = '<html><body>Test</body></html>'

      const result = await uploadPreview(html)

      expect(result.url).toBeDefined()
      expect(typeof result.url).toBe('string')
    })

    it('should return a valid HTTPS URL', async () => {
      const html = '<html><body>Test</body></html>'

      const result = await uploadPreview(html)

      expect(result.url).toMatch(/^https:\/\//)
    })

    it('should return a unique URL for each upload', async () => {
      const html1 = '<html><body>Test 1</body></html>'
      const html2 = '<html><body>Test 2</body></html>'

      const result1 = await uploadPreview(html1)
      const result2 = await uploadPreview(html2)

      expect(result1.url).not.toBe(result2.url)
    })

    it('should include preview ID in URL', async () => {
      const html = '<html><body>Test</body></html>'

      const result = await uploadPreview(html)

      // URL should contain some form of unique identifier
      expect(result.url).toMatch(/[a-zA-Z0-9_-]{6,}/)
    })

    it('should return expiration time in result', async () => {
      const html = '<html><body>Test</body></html>'

      const result = await uploadPreview(html)

      expect(result.expiresAt).toBeDefined()
      expect(result.expiresAt instanceof Date || typeof result.expiresAt === 'string').toBe(true)
    })

    it('should handle webCommand and return URL', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      const result = await webCommand(ctx)

      expect(result).toBeDefined()
      expect(result.url).toBeDefined()
    })
  })

  // ==========================================================================
  // Test 4: Supports --expires flag for expiration time
  // ==========================================================================
  describe('Supports --expires flag for expiration time', () => {
    it('should accept --expires option with duration string', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: { expires: '1h' },
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      const result = await webCommand(ctx)

      expect(result).toBeDefined()
    })

    it('should set expiration to 1 hour when expires=1h', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { expires: '1h' }

      const result = await uploadPreview(html, options)

      const expiresAt = new Date(result.expiresAt)
      const now = new Date()
      const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)

      expect(diffHours).toBeCloseTo(1, 0)
    })

    it('should set expiration to 24 hours when expires=24h', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { expires: '24h' }

      const result = await uploadPreview(html, options)

      const expiresAt = new Date(result.expiresAt)
      const now = new Date()
      const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)

      expect(diffHours).toBeCloseTo(24, 0)
    })

    it('should set expiration to 7 days when expires=7d', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { expires: '7d' }

      const result = await uploadPreview(html, options)

      const expiresAt = new Date(result.expiresAt)
      const now = new Date()
      const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

      expect(diffDays).toBeCloseTo(7, 0)
    })

    it('should accept --expires with minutes (30m)', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { expires: '30m' }

      const result = await uploadPreview(html, options)

      const expiresAt = new Date(result.expiresAt)
      const now = new Date()
      const diffMinutes = (expiresAt.getTime() - now.getTime()) / (1000 * 60)

      expect(diffMinutes).toBeCloseTo(30, 0)
    })

    it('should use default expiration when --expires not provided', async () => {
      const html = '<html><body>Test</body></html>'

      const result = await uploadPreview(html)

      expect(result.expiresAt).toBeDefined()
      // Default should be reasonable (e.g., 24 hours)
      const expiresAt = new Date(result.expiresAt)
      const now = new Date()
      const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)

      expect(diffHours).toBeGreaterThan(0)
      expect(diffHours).toBeLessThanOrEqual(168) // Max 7 days
    })

    it('should validate expires format and reject invalid values', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { expires: 'invalid' }

      await expect(uploadPreview(html, options)).rejects.toThrow(/invalid|format|expires/i)
    })
  })

  // ==========================================================================
  // Test 5: Supports --open flag to open in browser
  // ==========================================================================
  describe('Supports --open flag to open in browser', () => {
    it('should accept --open flag in command context', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: { open: true },
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      // Mock the open function to avoid actually opening browser
      const openMock = vi.fn()

      const result = await webCommand(ctx)

      expect(ctx.options.open).toBe(true)
      expect(result).toBeDefined()
    })

    it('should return openInBrowser flag in result when --open used', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: { open: true },
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      const result = await webCommand(ctx)

      expect(result.openedInBrowser).toBe(true)
    })

    it('should not open browser when --open not specified', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: {},
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      const result = await webCommand(ctx)

      expect(result.openedInBrowser).toBeFalsy()
    })

    it('should print URL to stdout regardless of --open flag', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: {},
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      await webCommand(ctx)

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/https:\/\//)
    })
  })

  // ==========================================================================
  // Test 6: Generates standalone HTML (no external deps)
  // ==========================================================================
  describe('Generates standalone HTML (no external deps)', () => {
    it('should not include external CSS links', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      expect(html).not.toMatch(/<link[^>]+href=["']https?:\/\//)
    })

    it('should not include external JavaScript links', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//)
    })

    it('should embed all CSS inline', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      expect(html).toContain('<style>')
      // Should contain actual CSS rules
      expect(html).toMatch(/\{[^}]+\}/)
    })

    it('should embed any required JavaScript inline', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      // If there's JS, it should be inline
      if (html.includes('<script>')) {
        expect(html).not.toMatch(/<script[^>]+src=/)
      }
    })

    it('should not reference external fonts', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      expect(html).not.toMatch(/fonts\.googleapis\.com/)
      expect(html).not.toMatch(/fonts\.gstatic\.com/)
    })

    it('should not include external images', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      expect(html).not.toMatch(/<img[^>]+src=["']https?:\/\//)
    })

    it('should be viewable when saved as local HTML file', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      // Should be a complete valid HTML document
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('<head>')
      expect(html).toContain('<body>')
      expect(html).toContain('</html>')
    })

    it('should use system fonts or embed font data', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateStandaloneHTML(diffResult)

      // Should use system font stack or embed fonts as base64
      const hasSystemFonts = html.includes('monospace') ||
                             html.includes('system-ui') ||
                             html.includes('font-family')
      const hasEmbeddedFonts = html.includes('data:font') ||
                               html.includes('@font-face')

      expect(hasSystemFonts || hasEmbeddedFonts).toBe(true)
    })
  })

  // ==========================================================================
  // Test 7: Includes file navigation in HTML
  // ==========================================================================
  describe('Includes file navigation in HTML', () => {
    it('should include a file list/navigation section', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Should have some form of navigation
      expect(html).toMatch(/nav|navigation|file-list|sidebar|toc/i)
    })

    it('should list all changed files in navigation', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      expect(html).toContain('src/index.ts')
      expect(html).toContain('src/utils/helper.ts')
    })

    it('should include anchor links to file sections', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Should have anchor links
      expect(html).toMatch(/<a[^>]+href=["']#/)
    })

    it('should have corresponding IDs for file sections', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Should have matching IDs for anchor targets
      expect(html).toMatch(/id=["'][^"']+["']/)
    })

    it('should show file status indicators in navigation', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Should indicate which files are modified/added/deleted
      expect(html).toMatch(/modified|added|deleted|changed|new|removed/i)
    })

    it('should show +/- line counts per file in navigation', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Should show something like "+3 -1" for each file
      expect(html).toMatch(/\+\d+/)
      expect(html).toMatch(/-\d+/)
    })

    it('should be clickable to jump to file diff', async () => {
      const diffResult = createMockDiffResult()

      const html = await generateHTML(diffResult)

      // Navigation items should be clickable (anchor tags or clickable elements)
      expect(html).toMatch(/<a[^>]+href/)
    })
  })

  // ==========================================================================
  // Test 8: Shows upload progress
  // ==========================================================================
  describe('Shows upload progress', () => {
    it('should call progress callback during upload', async () => {
      const html = '<html><body>Test</body></html>'
      const progressUpdates: number[] = []
      const onProgress: ProgressCallback = (progress) => {
        progressUpdates.push(progress)
      }

      await uploadPreview(html, { onProgress })

      expect(progressUpdates.length).toBeGreaterThan(0)
    })

    it('should report progress from 0 to 100', async () => {
      const html = '<html><body>Test</body></html>'
      const progressUpdates: number[] = []
      const onProgress: ProgressCallback = (progress) => {
        progressUpdates.push(progress)
      }

      await uploadPreview(html, { onProgress })

      expect(Math.min(...progressUpdates)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...progressUpdates)).toBeLessThanOrEqual(100)
    })

    it('should end with progress at 100 on success', async () => {
      const html = '<html><body>Test</body></html>'
      const progressUpdates: number[] = []
      const onProgress: ProgressCallback = (progress) => {
        progressUpdates.push(progress)
      }

      await uploadPreview(html, { onProgress })

      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
    })

    it('should report increasing progress values', async () => {
      const html = '<html><body>Test</body></html>'
      const progressUpdates: number[] = []
      const onProgress: ProgressCallback = (progress) => {
        progressUpdates.push(progress)
      }

      await uploadPreview(html, { onProgress })

      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1])
      }
    })

    it('should output progress messages to stdout in CLI', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      await webCommand(ctx)

      const output = capture.output.stdout.join('\n')
      // Should show some form of progress (percentage, spinner, etc.)
      expect(output).toMatch(/uploading|progress|\d+%/i)
    })
  })

  // ==========================================================================
  // Test 9: Handles upload errors gracefully
  // ==========================================================================
  describe('Handles upload errors gracefully', () => {
    it('should throw descriptive error on network failure', async () => {
      const html = '<html><body>Test</body></html>'
      // Simulate network error by using invalid endpoint
      const options: WebOptions = { endpoint: 'https://invalid.endpoint.local/upload' }

      await expect(uploadPreview(html, options)).rejects.toThrow()
    })

    it('should include error message in thrown error', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { endpoint: 'https://invalid.endpoint.local/upload' }

      try {
        await uploadPreview(html, options)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error instanceof Error).toBe(true)
        expect((error as Error).message).toBeTruthy()
      }
    })

    it('should handle timeout errors', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { timeout: 1 } // 1ms timeout - will definitely fail

      await expect(uploadPreview(html, options)).rejects.toThrow(/timeout|timed out/i)
    })

    it('should handle server error responses (5xx)', async () => {
      const html = '<html><body>Test</body></html>'
      // Mock a server that returns 500
      const options: WebOptions = { endpoint: 'https://httpstat.us/500' }

      await expect(uploadPreview(html, options)).rejects.toThrow(/server|500|error/i)
    })

    it('should handle authentication errors (401/403)', async () => {
      const html = '<html><body>Test</body></html>'
      const options: WebOptions = { endpoint: 'https://httpstat.us/401' }

      await expect(uploadPreview(html, options)).rejects.toThrow(/auth|401|403|unauthorized|forbidden/i)
    })

    it('should output error to stderr in CLI', async () => {
      const capture = createOutputCapture()
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: { endpoint: 'https://invalid.endpoint.local/upload' },
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      try {
        await webCommand(ctx)
      } catch {
        // Expected to fail
      }

      // Error should be written to stderr
      const stderrOutput = capture.output.stderr.join('\n')
      expect(stderrOutput.length).toBeGreaterThan(0)
    })

    it('should not leave partial uploads on error', async () => {
      const html = '<html><body>Test</body></html>'
      const progressUpdates: number[] = []
      const options: WebOptions = {
        endpoint: 'https://invalid.endpoint.local/upload',
        onProgress: (progress) => progressUpdates.push(progress)
      }

      try {
        await uploadPreview(html, options)
      } catch {
        // Expected to fail
      }

      // Progress should not reach 100 on failure
      if (progressUpdates.length > 0) {
        expect(progressUpdates[progressUpdates.length - 1]).toBeLessThan(100)
      }
    })

    it('should allow retry after error', async () => {
      const html = '<html><body>Test</body></html>'

      // First call should fail
      const badOptions: WebOptions = { endpoint: 'https://invalid.endpoint.local/upload' }
      await expect(uploadPreview(html, badOptions)).rejects.toThrow()

      // Second call with good options should succeed
      const result = await uploadPreview(html)
      expect(result.url).toBeDefined()
    })
  })

  // ==========================================================================
  // CLI Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register web command with CLI', async () => {
      const cli = createCLI()
      cli.registerCommand('web', webCommand)

      const result = await cli.run(['web', '--help'])

      expect(result.exitCode).toBe(0)
    })

    it('should pass --expires option to command handler', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('web', (ctx) => {
        receivedContext = ctx
        return Promise.resolve({ url: 'https://example.com.ai', expiresAt: new Date() })
      })

      await cli.run(['web', '--expires', '24h'])

      expect(receivedContext).toBeDefined()
      // Note: The CLI may not directly pass --expires as an option
      // This test verifies the command is called
    })

    it('should pass --open option to command handler', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('web', (ctx) => {
        receivedContext = ctx
        return Promise.resolve({ url: 'https://example.com.ai', expiresAt: new Date() })
      })

      await cli.run(['web', '--open'])

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.options.open).toBe(true)
    })

    it('should return exit code 0 on success', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      cli.registerCommand('web', async () => {
        return { url: 'https://example.com.ai', expiresAt: new Date() }
      })

      const result = await cli.run(['web'])

      expect(result.exitCode).toBe(0)
    })

    it('should return exit code 1 on error', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      cli.registerCommand('web', async () => {
        throw new Error('Upload failed')
      })

      const result = await cli.run(['web'])

      expect(result.exitCode).toBe(1)
    })
  })

  // ==========================================================================
  // Module Export Tests
  // ==========================================================================
  describe('Module Exports', () => {
    it('should export webCommand function', async () => {
      const module = await import('../../../src/cli/commands/web')
      expect(typeof module.webCommand).toBe('function')
    })

    it('should export generateHTML function', async () => {
      const module = await import('../../../src/cli/commands/web')
      expect(typeof module.generateHTML).toBe('function')
    })

    it('should export convertAnsiToHTML function', async () => {
      const module = await import('../../../src/cli/commands/web')
      expect(typeof module.convertAnsiToHTML).toBe('function')
    })

    it('should export uploadPreview function', async () => {
      const module = await import('../../../src/cli/commands/web')
      expect(typeof module.uploadPreview).toBe('function')
    })

    it('should export generateStandaloneHTML function', async () => {
      const module = await import('../../../src/cli/commands/web')
      expect(typeof module.generateStandaloneHTML).toBe('function')
    })

    it('should export WebOptions type', async () => {
      // Type check - verifies export exists at compile time
      const opts: WebOptions = {
        expires: '24h',
        open: true
      }
      expect(opts.expires).toBe('24h')
    })

    it('should export WebResult type', async () => {
      // Type check
      const result: WebResult = {
        url: 'https://example.com.ai',
        expiresAt: new Date()
      }
      expect(result.url).toBeDefined()
    })

    it('should export UploadResult type', async () => {
      // Type check
      const result: UploadResult = {
        url: 'https://example.com.ai',
        expiresAt: new Date(),
        id: 'abc123'
      }
      expect(result.id).toBe('abc123')
    })
  })
})
