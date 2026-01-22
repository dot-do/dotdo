// CLI Pull Command Tests - TDD for rpc.do CLI
// Tests the `rpc.do pull` command for fetching TypeScript types from endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Module under test (will be created in GREEN phase)
import { pull, type PullOptions } from '../src/cli/pull'

// ============================================================================
// Helper: Create temp directory for testing file operations
// ============================================================================

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-do-cli-test-'))
})

afterEach(async () => {
  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true })
})

// ============================================================================
// `rpc.do pull <endpoint>` - Basic functionality
// ============================================================================

describe('rpc.do pull <endpoint>', () => {
  it('fetches types from <endpoint>/_types', async () => {
    const endpoint = 'https://api.test.com'
    const typesDef = `export interface $ {
  things: { create(data: any): Promise<Thing> }
}`

    // Mock fetch to return types
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })
    globalThis.fetch = mockFetch

    const result = await pull({
      endpoint,
      outPath: path.join(tempDir, '.do', '$.d.ts'),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `${endpoint}/rpc`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ method: '_types', args: [] }),
      })
    )
    expect(result.success).toBe(true)
  })

  it('defaults to .do/$.d.ts output path', async () => {
    const endpoint = 'https://api.test.com'
    const typesDef = 'export interface $ { foo(): void }'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    const result = await pull({
      endpoint,
      cwd: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.outPath).toBe(path.join(tempDir, '.do', '$.d.ts'))

    // Verify file was written
    const content = await fs.readFile(result.outPath!, 'utf-8')
    expect(content).toBe(typesDef)
  })
})

// ============================================================================
// `rpc.do pull --from <url>` - Custom endpoint
// ============================================================================

describe('rpc.do pull --from <url>', () => {
  it('uses custom endpoint when --from is provided', async () => {
    const customUrl = 'https://custom.endpoint.com/api'
    const typesDef = 'export interface $ { custom(): void }'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })
    globalThis.fetch = mockFetch

    const result = await pull({
      endpoint: customUrl,
      outPath: path.join(tempDir, '.do', '$.d.ts'),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `${customUrl}/rpc`,
      expect.objectContaining({
        body: JSON.stringify({ method: '_types', args: [] }),
      })
    )
    expect(result.success).toBe(true)
  })

  it('handles endpoints with trailing slash', async () => {
    const endpoint = 'https://api.test.com/'
    const typesDef = 'export interface $ { test(): void }'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })
    globalThis.fetch = mockFetch

    const result = await pull({
      endpoint,
      outPath: path.join(tempDir, '.do', '$.d.ts'),
    })

    // Should normalize trailing slash
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.com/rpc',
      expect.anything()
    )
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// `rpc.do pull --out <path>` - Custom output path
// ============================================================================

describe('rpc.do pull --out <path>', () => {
  it('writes to custom path instead of .do/$.d.ts', async () => {
    const customPath = path.join(tempDir, 'custom', 'types', 'api.d.ts')
    const typesDef = 'export interface $ { custom(): void }'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      outPath: customPath,
    })

    expect(result.success).toBe(true)
    expect(result.outPath).toBe(customPath)

    // Verify file was written to custom path
    const content = await fs.readFile(customPath, 'utf-8')
    expect(content).toBe(typesDef)
  })

  it('creates nested directories for custom path', async () => {
    const nestedPath = path.join(tempDir, 'deep', 'nested', 'path', 'types.d.ts')
    const typesDef = 'export interface $ { nested(): void }'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      outPath: nestedPath,
    })

    expect(result.success).toBe(true)

    // Verify file exists at nested path
    const content = await fs.readFile(nestedPath, 'utf-8')
    expect(content).toBe(typesDef)
  })
})

// ============================================================================
// Creates .do/ directory if not exists
// ============================================================================

describe('Directory creation', () => {
  it('creates .do/ directory if it does not exist', async () => {
    const typesDef = 'export interface $ { auto(): void }'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    // Ensure .do/ does not exist
    const doDir = path.join(tempDir, '.do')
    await fs.rm(doDir, { recursive: true, force: true })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(true)

    // Verify directory was created
    const stat = await fs.stat(doDir)
    expect(stat.isDirectory()).toBe(true)

    // Verify file was written
    const content = await fs.readFile(path.join(doDir, '$.d.ts'), 'utf-8')
    expect(content).toBe(typesDef)
  })

  it('works when .do/ already exists', async () => {
    const typesDef = 'export interface $ { exists(): void }'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    // Pre-create .do/ directory
    const doDir = path.join(tempDir, '.do')
    await fs.mkdir(doDir, { recursive: true })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Writes valid TypeScript to .do/$.d.ts
// ============================================================================

describe('TypeScript output validation', () => {
  it('writes valid TypeScript to output file', async () => {
    const typesDef = `// Generated by rpc.do
export interface $ {
  things: {
    create(data: CreateData): Promise<Thing>
    list(): Promise<Thing[]>
  }
  Customer: (id: string) => CustomerEntity
}

export interface CustomerEntity {
  getProfile(): Promise<Profile>
  update(data: Partial<Customer>): Promise<Customer>
}
`

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(true)

    const content = await fs.readFile(result.outPath!, 'utf-8')
    expect(content).toContain('export interface $')
    expect(content).toContain('CustomerEntity')
  })

  it('preserves exact TypeScript from server', async () => {
    const typesDef = `export interface $ {
  // Comment preserved
  method(): Promise<void>
}`

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    const content = await fs.readFile(result.outPath!, 'utf-8')
    expect(content).toBe(typesDef)
  })
})

// ============================================================================
// Network error handling
// ============================================================================

describe('Network error handling', () => {
  it('handles network timeout gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Request timed out'))

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
  })

  it('handles connection refused error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('handles DNS resolution failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

    const result = await pull({
      endpoint: 'https://nonexistent.domain.test',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOTFOUND')
  })

  it('handles HTTP 404 error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('404')
  })

  it('handles HTTP 500 error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('500')
  })

  it('handles invalid JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('handles RPC error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: '_types endpoint not available',
        },
      }),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('_types endpoint not available')
  })
})

// ============================================================================
// Progress output
// ============================================================================

describe('Progress output', () => {
  it('emits progress events during pull', async () => {
    const typesDef = 'export interface $ { progress(): void }'
    const progressEvents: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
      onProgress: (message) => progressEvents.push(message),
    })

    expect(result.success).toBe(true)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.some((e) => e.includes('Fetching'))).toBe(true)
    expect(progressEvents.some((e) => e.includes('Writing') || e.includes('Wrote'))).toBe(true)
  })

  it('includes endpoint in progress output', async () => {
    const typesDef = 'export interface $ { info(): void }'
    const progressEvents: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
      onProgress: (message) => progressEvents.push(message),
    })

    expect(progressEvents.some((e) => e.includes('api.test.com'))).toBe(true)
  })

  it('shows output path in completion message', async () => {
    const typesDef = 'export interface $ { complete(): void }'
    const progressEvents: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
      onProgress: (message) => progressEvents.push(message),
    })

    expect(progressEvents.some((e) => e.includes('.do/$.d.ts') || e.includes('$.d.ts'))).toBe(true)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases', () => {
  it('handles empty types response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(''),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
    })

    // Empty response should still succeed (write empty file)
    expect(result.success).toBe(true)
  })

  it('overwrites existing file', async () => {
    const existingContent = '// Old types'
    const newContent = 'export interface $ { new(): void }'

    const outPath = path.join(tempDir, '.do', '$.d.ts')
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, existingContent)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(newContent),
    })

    const result = await pull({
      endpoint: 'https://api.test.com',
      outPath,
    })

    expect(result.success).toBe(true)

    const content = await fs.readFile(outPath, 'utf-8')
    expect(content).toBe(newContent)
    expect(content).not.toContain('Old types')
  })

  it('handles endpoint with port number', async () => {
    const endpoint = 'http://localhost:8787'
    const typesDef = 'export interface $ { local(): void }'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })
    globalThis.fetch = mockFetch

    const result = await pull({
      endpoint,
      cwd: tempDir,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/rpc',
      expect.anything()
    )
    expect(result.success).toBe(true)
  })
})
