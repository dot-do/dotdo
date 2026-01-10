/**
 * TypeScript Strict Type Tests (RED phase - TDD)
 *
 * These tests verify TypeScript type safety improvements that DON'T EXIST YET.
 * They are designed to FAIL until the following improvements are made:
 *
 * 1. Remove `any` type from sync-form.tsx (line 65-66)
 * 2. Add type guards for WebSocket messages in use-dollar.ts
 * 3. Add Zod validation for RPC responses before use
 * 4. Export isRPCResponse type guard function
 * 5. Export isChangeEvent type guard for collection changes
 *
 * This is the RED phase of TDD - tests should fail until implementation.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// =============================================================================
// File Path Constants
// =============================================================================

// Tests are in app/tests/, source files are in app/
const APP_DIR = path.resolve(__dirname, '..')
const SYNC_FORM_PATH = path.join(APP_DIR, 'components/sync/sync-form.tsx')
const USE_DOLLAR_PATH = path.join(APP_DIR, 'lib/hooks/use-dollar.ts')
const USE_COLLECTION_PATH = path.join(APP_DIR, 'lib/hooks/use-collection.ts')

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Read file contents synchronously
 */
function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

/**
 * Check if a file exports a specific function
 */
function fileExportsFunction(filePath: string, functionName: string): boolean {
  const content = readFile(filePath)
  // Check for named export: export function functionName or export const functionName
  const namedExportPattern = new RegExp(
    `export\\s+(function|const)\\s+${functionName}\\b`
  )
  // Check for export in export statement: export { functionName }
  const exportListPattern = new RegExp(`export\\s*\\{[^}]*\\b${functionName}\\b`)

  return namedExportPattern.test(content) || exportListPattern.test(content)
}

/**
 * Check if a file contains a type guard function (returns x is Type)
 */
function fileContainsTypeGuard(filePath: string, guardName: string): boolean {
  const content = readFile(filePath)
  // Type guard pattern: function name(x): x is Type or const name = (x): x is Type
  const typeGuardPattern = new RegExp(
    `(function\\s+${guardName}|const\\s+${guardName}\\s*=)[^{]*:\\s*\\w+\\s+is\\s+\\w+`
  )
  return typeGuardPattern.test(content)
}

// =============================================================================
// Test: No `any` Type in sync-form.tsx
// =============================================================================

describe('sync-form.tsx type safety', () => {
  it('should NOT use `any` type in MinimalFormApi interface', () => {
    const content = readFile(SYNC_FORM_PATH)

    // Find the MinimalFormApi interface definition
    const interfaceMatch = content.match(
      /export\s+interface\s+MinimalFormApi[^{]*\{[\s\S]*?\n\}/
    )

    expect(interfaceMatch).not.toBeNull()

    if (interfaceMatch) {
      const interfaceContent = interfaceMatch[0]

      // Should NOT contain `any` type
      // Currently fails because line 66 has: export interface MinimalFormApi<TFormData = any>
      const hasAnyType = /\bany\b/.test(interfaceContent)

      expect(hasAnyType).toBe(false)
    }
  })

  it('should NOT have eslint-disable for @typescript-eslint/no-explicit-any', () => {
    const content = readFile(SYNC_FORM_PATH)

    // Should NOT contain eslint-disable for no-explicit-any
    // Currently fails because line 65 has: // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasEslintDisable = /@typescript-eslint\/no-explicit-any/.test(content)

    expect(hasEslintDisable).toBe(false)
  })

  it('should use proper generic constraint instead of any', () => {
    const content = readFile(SYNC_FORM_PATH)

    // MinimalFormApi should use a proper constraint like Record<string, unknown>
    // Expected: MinimalFormApi<TFormData extends Record<string, unknown> = Record<string, unknown>>
    // Current:  MinimalFormApi<TFormData = any>
    const hasProperConstraint = /MinimalFormApi<TFormData\s+extends\s+Record<string,\s*unknown>/.test(content)

    expect(hasProperConstraint).toBe(true)
  })
})

// =============================================================================
// Test: Type Guards for WebSocket Messages in use-dollar.ts
// =============================================================================

describe('use-dollar.ts type guards', () => {
  it('should export isRPCResponse type guard function', () => {
    // This test will FAIL until isRPCResponse is exported from use-dollar.ts
    // The function should validate that a message is a valid RPC response
    const hasExport = fileExportsFunction(USE_DOLLAR_PATH, 'isRPCResponse')

    expect(hasExport).toBe(true)
  })

  it('should have isRPCResponse as a proper type guard (returns x is RPCResponse)', () => {
    // This test will FAIL until isRPCResponse is implemented as a type guard
    const hasTypeGuard = fileContainsTypeGuard(USE_DOLLAR_PATH, 'isRPCResponse')

    expect(hasTypeGuard).toBe(true)
  })

  it('should validate WebSocket message before casting to RPCResponse', () => {
    const content = readFile(USE_DOLLAR_PATH)

    // Find the handleMessage function
    const handleMessageMatch = content.match(
      /const\s+handleMessage\s*=\s*useCallback\s*\(\s*\(event:\s*MessageEvent\)[^{]*\{[\s\S]*?\n\s*\},\s*\[\]/
    )

    expect(handleMessageMatch).not.toBeNull()

    if (handleMessageMatch) {
      const handleMessageContent = handleMessageMatch[0]

      // Should use isRPCResponse type guard instead of direct cast
      // Currently fails because line 595 does: data = JSON.parse(event.data) as RPCResponse
      const usesTypeGuard = /isRPCResponse\s*\(/.test(handleMessageContent)
      const hasDirectCast = /as\s+RPCResponse\b/.test(handleMessageContent)

      // Should use type guard, not direct cast
      expect(usesTypeGuard).toBe(true)
      expect(hasDirectCast).toBe(false)
    }
  })

  it('should export isStateMessage type guard function', () => {
    // For validating state messages from the server
    const hasExport = fileExportsFunction(USE_DOLLAR_PATH, 'isStateMessage')

    expect(hasExport).toBe(true)
  })

  it('should export isBatchResponse type guard function', () => {
    // For validating batch response messages
    const hasExport = fileExportsFunction(USE_DOLLAR_PATH, 'isBatchResponse')

    expect(hasExport).toBe(true)
  })

  it('should export isEventMessage type guard function', () => {
    // For validating event messages from the server
    const hasExport = fileExportsFunction(USE_DOLLAR_PATH, 'isEventMessage')

    expect(hasExport).toBe(true)
  })
})

// =============================================================================
// Test: RPC Response Validation with Zod
// =============================================================================

describe('RPC response Zod validation', () => {
  it('should export RPCResponseSchema Zod schema from use-dollar.ts', () => {
    const content = readFile(USE_DOLLAR_PATH)

    // Should have a Zod schema for RPC responses
    const hasZodSchema = /export\s+(const|let)\s+RPCResponseSchema\s*=\s*z\./.test(content)

    expect(hasZodSchema).toBe(true)
  })

  it('should import zod in use-dollar.ts', () => {
    const content = readFile(USE_DOLLAR_PATH)

    // Should import zod for runtime validation
    const hasZodImport = /import\s+.*\bz\b.*\s+from\s+['"]zod['"]/.test(content) ||
                         /import\s+\{\s*z\s*\}\s+from\s+['"]zod['"]/.test(content) ||
                         /import\s+\*\s+as\s+z\s+from\s+['"]zod['"]/.test(content)

    expect(hasZodImport).toBe(true)
  })

  it('should use Zod safeParse for RPC response validation', () => {
    const content = readFile(USE_DOLLAR_PATH)

    // Should use safeParse for validation before using response data
    const usesSafeParse = /\.safeParse\s*\(/.test(content)

    expect(usesSafeParse).toBe(true)
  })
})

// =============================================================================
// Test: isRPCResponse Type Guard Runtime Behavior
// =============================================================================

describe('isRPCResponse type guard runtime behavior', () => {
  // These tests will fail until the type guard is implemented and exported

  it('should return true for valid response message', async () => {
    // Dynamic import to get the actual function
    const module = await import('../lib/hooks/use-dollar')

    // Type guard should exist
    expect(typeof module.isRPCResponse).toBe('function')

    const validResponse = {
      type: 'response',
      id: 'req_123',
      result: { data: 'test' },
    }

    expect(module.isRPCResponse(validResponse)).toBe(true)
  })

  it('should return true for valid batch-response message', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    const validBatchResponse = {
      type: 'batch-response',
      results: [
        { id: 0, result: { data: 'test1' } },
        { id: 1, result: { data: 'test2' } },
      ],
    }

    expect(module.isRPCResponse(validBatchResponse)).toBe(true)
  })

  it('should return true for valid event message', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    const validEvent = {
      type: 'event',
      event: 'Customer.signup',
      data: { email: 'test@example.com' },
    }

    expect(module.isRPCResponse(validEvent)).toBe(true)
  })

  it('should return true for valid state message', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    const validState = {
      type: 'state',
      data: { counter: 1 },
      txid: 123,
    }

    expect(module.isRPCResponse(validState)).toBe(true)
  })

  it('should return false for invalid message (missing type)', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    const invalidMessage = {
      id: 'req_123',
      result: { data: 'test' },
      // missing 'type' field
    }

    expect(module.isRPCResponse(invalidMessage)).toBe(false)
  })

  it('should return false for invalid message (wrong type value)', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    const invalidMessage = {
      type: 'invalid-type',
      data: { something: 'test' },
    }

    expect(module.isRPCResponse(invalidMessage)).toBe(false)
  })

  it('should return false for null or undefined', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    expect(module.isRPCResponse(null)).toBe(false)
    expect(module.isRPCResponse(undefined)).toBe(false)
  })

  it('should return false for primitive values', async () => {
    const module = await import('../lib/hooks/use-dollar')

    expect(typeof module.isRPCResponse).toBe('function')

    expect(module.isRPCResponse('string')).toBe(false)
    expect(module.isRPCResponse(123)).toBe(false)
    expect(module.isRPCResponse(true)).toBe(false)
  })
})

// =============================================================================
// Test: isChangeEvent Type Guard for Collection Changes
// =============================================================================

describe('use-collection.ts type guards', () => {
  it('should export isChangeEvent type guard function', () => {
    // This test will FAIL until isChangeEvent is exported from use-collection.ts
    const hasExport = fileExportsFunction(USE_COLLECTION_PATH, 'isChangeEvent')

    expect(hasExport).toBe(true)
  })

  it('should have isChangeEvent as a proper type guard (returns x is ChangeEvent)', () => {
    // This test will FAIL until isChangeEvent is implemented as a type guard
    const hasTypeGuard = fileContainsTypeGuard(USE_COLLECTION_PATH, 'isChangeEvent')

    expect(hasTypeGuard).toBe(true)
  })

  it('should validate change event before casting in real-time sync', () => {
    const content = readFile(USE_COLLECTION_PATH)

    // Find the real-time sync subscription effect
    // Look for where change events are handled
    const hasDirectCast = /const\s+changeEvent\s*=\s*event\s+as\s+ChangeEvent/.test(content)
    const usesTypeGuard = /isChangeEvent\s*\(/.test(content)

    // Should use type guard, not direct cast
    // Currently fails because line 482-483 does: const changeEvent = event as ChangeEvent<T>
    expect(usesTypeGuard).toBe(true)
    expect(hasDirectCast).toBe(false)
  })
})

// =============================================================================
// Test: isChangeEvent Type Guard Runtime Behavior
// =============================================================================

describe('isChangeEvent type guard runtime behavior', () => {
  it('should return true for valid insert change event', async () => {
    const module = await import('../lib/hooks/use-collection')

    // Type guard should exist
    expect(typeof module.isChangeEvent).toBe('function')

    const validInsert = {
      type: 'insert',
      data: { $id: '123', name: 'Test' },
    }

    expect(module.isChangeEvent(validInsert)).toBe(true)
  })

  it('should return true for valid update change event', async () => {
    const module = await import('../lib/hooks/use-collection')

    expect(typeof module.isChangeEvent).toBe('function')

    const validUpdate = {
      type: 'update',
      data: { $id: '123', name: 'Updated' },
    }

    expect(module.isChangeEvent(validUpdate)).toBe(true)
  })

  it('should return true for valid delete change event', async () => {
    const module = await import('../lib/hooks/use-collection')

    expect(typeof module.isChangeEvent).toBe('function')

    const validDelete = {
      type: 'delete',
      id: '123',
    }

    expect(module.isChangeEvent(validDelete)).toBe(true)
  })

  it('should return false for invalid change event (wrong type)', async () => {
    const module = await import('../lib/hooks/use-collection')

    expect(typeof module.isChangeEvent).toBe('function')

    const invalidEvent = {
      type: 'invalid',
      data: { something: 'test' },
    }

    expect(module.isChangeEvent(invalidEvent)).toBe(false)
  })

  it('should return false for invalid change event (missing type)', async () => {
    const module = await import('../lib/hooks/use-collection')

    expect(typeof module.isChangeEvent).toBe('function')

    const invalidEvent = {
      data: { $id: '123', name: 'Test' },
      // missing 'type' field
    }

    expect(module.isChangeEvent(invalidEvent)).toBe(false)
  })

  it('should return false for null or undefined', async () => {
    const module = await import('../lib/hooks/use-collection')

    expect(typeof module.isChangeEvent).toBe('function')

    expect(module.isChangeEvent(null)).toBe(false)
    expect(module.isChangeEvent(undefined)).toBe(false)
  })
})

// =============================================================================
// Test: Export ChangeEvent Type
// =============================================================================

describe('ChangeEvent type export', () => {
  it('should export ChangeEvent type from use-collection.ts', () => {
    const content = readFile(USE_COLLECTION_PATH)

    // ChangeEvent interface should be exported, not just internal
    // Currently it's marked @internal and not exported
    const hasExportedType = /export\s+(interface|type)\s+ChangeEvent\b/.test(content)

    expect(hasExportedType).toBe(true)
  })

  it('should export ChangeEventType type from use-collection.ts', () => {
    const content = readFile(USE_COLLECTION_PATH)

    // ChangeEventType should be exported for consumers to use
    const hasExportedType = /export\s+type\s+ChangeEventType\b/.test(content)

    expect(hasExportedType).toBe(true)
  })
})

// =============================================================================
// Test: Export RPCResponse Type
// =============================================================================

describe('RPCResponse type export', () => {
  it('should export RPCResponse type from use-dollar.ts', () => {
    const content = readFile(USE_DOLLAR_PATH)

    // RPCResponse interface should be exported, not just internal
    // Currently it's marked @internal and not exported
    const hasExportedType = /export\s+(interface|type)\s+RPCResponse\b/.test(content)

    expect(hasExportedType).toBe(true)
  })

  it('should export RPCResponseType type from use-dollar.ts', () => {
    const content = readFile(USE_DOLLAR_PATH)

    // RPCResponseType should be exported for consumers to use
    const hasExportedType = /export\s+type\s+RPCResponseType\b/.test(content)

    expect(hasExportedType).toBe(true)
  })
})
