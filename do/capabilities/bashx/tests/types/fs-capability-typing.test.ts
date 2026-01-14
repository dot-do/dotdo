/**
 * FsCapability Typing Tests - TDD for Type-Safe Read Operations
 *
 * These tests verify that FsCapability.read() return types are properly
 * inferred based on the encoding option, eliminating the need for `as string` casts.
 *
 * Problem: FsCapability from fsx.do returns `Promise<string | Uint8Array>`,
 * which requires type assertions when encoding is specified.
 *
 * Solution: Create a TypedFsCapability interface with proper function overloads
 * that infer the return type based on the encoding option.
 *
 * @packageDocumentation
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { TypedFsCapability, TypedReadOptions, StringEncoding } from '../../src/types.js'

describe('FsCapability Read Type Inference', () => {
  // ==========================================================================
  // Type-level tests using expectTypeOf from vitest
  // ==========================================================================
  describe('TypedFsCapability interface', () => {
    it('should infer string return type when encoding is specified', async () => {
      // Create a mock that satisfies TypedFsCapability
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          if (options?.encoding) return 'content'
          return new Uint8Array([1, 2, 3])
        },
      } as TypedFsCapability

      // When encoding is 'utf-8', should return string
      const result = await mockFs.read('/test.txt', { encoding: 'utf-8' })

      // Type assertion: result should be inferred as string
      expectTypeOf(result).toMatchTypeOf<string>()

      // Runtime check
      expect(typeof result).toBe('string')
    })

    it('should infer Uint8Array return type when no encoding is specified', async () => {
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          if (options?.encoding) return 'content'
          return new Uint8Array([1, 2, 3])
        },
      } as TypedFsCapability

      // When no encoding, should return Uint8Array
      const result = await mockFs.read('/test.txt')

      expectTypeOf(result).toMatchTypeOf<Uint8Array>()
      expect(result instanceof Uint8Array).toBe(true)
    })

    it('should infer Uint8Array return type when encoding is null', async () => {
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          if (options?.encoding) return 'content'
          return new Uint8Array([1, 2, 3])
        },
      } as TypedFsCapability

      // When encoding is null, should return Uint8Array
      const result = await mockFs.read('/test.txt', { encoding: null })

      expectTypeOf(result).toMatchTypeOf<Uint8Array>()
    })

    it('should accept all valid string encodings', async () => {
      const mockFs: TypedFsCapability = {
        read: async () => 'content',
      } as TypedFsCapability

      // All these should compile and return string
      const utf8 = await mockFs.read('/test.txt', { encoding: 'utf-8' })
      const utf8Alt = await mockFs.read('/test.txt', { encoding: 'utf8' })
      const latin1 = await mockFs.read('/test.txt', { encoding: 'latin1' })
      const ascii = await mockFs.read('/test.txt', { encoding: 'ascii' })
      const base64 = await mockFs.read('/test.txt', { encoding: 'base64' })
      const hex = await mockFs.read('/test.txt', { encoding: 'hex' })
      const binary = await mockFs.read('/test.txt', { encoding: 'binary' })

      expectTypeOf(utf8).toMatchTypeOf<string>()
      expectTypeOf(utf8Alt).toMatchTypeOf<string>()
      expectTypeOf(latin1).toMatchTypeOf<string>()
      expectTypeOf(ascii).toMatchTypeOf<string>()
      expectTypeOf(base64).toMatchTypeOf<string>()
      expectTypeOf(hex).toMatchTypeOf<string>()
      expectTypeOf(binary).toMatchTypeOf<string>()
    })
  })

  // ==========================================================================
  // Backward Compatibility Tests
  // ==========================================================================
  describe('Backward compatibility with FsCapability', () => {
    it('TypedFsCapability should be assignable to FsCapability usage patterns', () => {
      // This ensures TypedFsCapability can be used wherever FsCapability is expected
      const typedFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          if (options?.encoding) return 'content'
          return new Uint8Array([1, 2, 3])
        },
        exists: async () => true,
        list: async () => [],
        stat: async () => ({
          size: 0,
          isFile: () => true,
          isDirectory: () => false,
        }),
      } as TypedFsCapability

      // Should be usable in contexts expecting FsCapability
      // The types should be structurally compatible
      expect(typedFs.read).toBeDefined()
      expect(typedFs.exists).toBeDefined()
    })
  })

  // ==========================================================================
  // Integration Tests - Simulating TieredExecutor Usage
  // ==========================================================================
  describe('TieredExecutor usage patterns (no casts needed)', () => {
    it('should work without cast for cat command pattern', async () => {
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          return 'file content'
        },
      } as TypedFsCapability

      // This is the pattern used in TieredExecutor - should NOT need 'as string'
      const content = await mockFs.read('/file.txt', { encoding: 'utf-8' })

      // TypeScript should know this is a string without casting
      const lines = content.split('\n')

      expect(lines).toBeDefined()
      expect(typeof content).toBe('string')
    })

    it('should work without cast for input redirection pattern', async () => {
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          return 'input content'
        },
      } as TypedFsCapability

      // Pattern from line 1238: const inputContent = await this.fs.read(inputFile, { encoding: 'utf-8' }) as string
      const inputContent = await mockFs.read('/input.txt', { encoding: 'utf-8' })

      // Should be able to use string methods directly
      const trimmed = inputContent.trim()
      const upperCase = inputContent.toUpperCase()

      expect(trimmed).toBe('input content')
      expect(upperCase).toBe('INPUT CONTENT')
    })

    it('should work without cast for wc command pattern', async () => {
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          return 'line1\nline2\nline3'
        },
      } as TypedFsCapability

      // Pattern from wc implementation
      const content = await mockFs.read('/file.txt', { encoding: 'utf-8' })
      const lines = content.split('\n')
      const words = content.split(/\s+/).filter(Boolean)
      const chars = content.length

      expect(lines.length).toBe(3)
      expect(words.length).toBe(3)
      expect(chars).toBe(17)
    })

    it('should work without cast for diff command pattern', async () => {
      const mockFs: TypedFsCapability = {
        read: async (path: string, options?: TypedReadOptions) => {
          if (path === '/file1.txt') return 'content1'
          if (path === '/file2.txt') return 'content2'
          throw new Error('Not found')
        },
      } as TypedFsCapability

      // Pattern from lines 2645-2646
      const file1Content = await mockFs.read('/file1.txt', { encoding: 'utf-8' })
      const file2Content = await mockFs.read('/file2.txt', { encoding: 'utf-8' })

      // Should be able to compare strings directly
      expect(file1Content === file2Content).toBe(false)
      expect(file1Content.length + file2Content.length).toBe(16)
    })
  })

  // ==========================================================================
  // StringEncoding Type Tests
  // ==========================================================================
  describe('StringEncoding type', () => {
    it('should include all supported buffer encodings', () => {
      // These should all be valid StringEncoding values (matches fsx.do BufferEncoding)
      const encodings: StringEncoding[] = [
        'utf-8',
        'utf8',
        'latin1',
        'binary',
        'ascii',
        'base64',
        'hex',
      ]

      expect(encodings).toHaveLength(7)
    })
  })
})
