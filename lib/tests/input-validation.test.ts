/**
 * Input Validation Tests
 *
 * RED phase: Tests for invalid inputs at public API entry points.
 * These tests verify that APIs properly validate inputs before processing.
 *
 * Focus areas:
 * - primitives public exports (fsx, bashx, npmx, pyx)
 * - db/stores.ts store methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  validateInput,
  validateString,
  validateNumber,
  validateObject,
  validateArray,
  validateNonEmptyString,
  validateId,
  validatePath,
  validateOptions,
  createInputValidator,
  InputValidationError,
} from '../validation/input-validators'

describe('Input Validation Utilities', () => {
  describe('validateInput', () => {
    it('should throw InputValidationError for null input', () => {
      const schema = z.string()
      expect(() => validateInput(null, schema, 'testInput')).toThrow(InputValidationError)
      expect(() => validateInput(null, schema, 'testInput')).toThrow('testInput is required')
    })

    it('should throw InputValidationError for undefined input', () => {
      const schema = z.string()
      expect(() => validateInput(undefined, schema, 'testInput')).toThrow(InputValidationError)
      expect(() => validateInput(undefined, schema, 'testInput')).toThrow('testInput is required')
    })

    it('should throw InputValidationError for wrong type', () => {
      const schema = z.string()
      expect(() => validateInput(123, schema, 'testInput')).toThrow(InputValidationError)
    })

    it('should return valid input when schema matches', () => {
      const schema = z.string()
      const result = validateInput('hello', schema, 'testInput')
      expect(result).toBe('hello')
    })

    it('should allow null when schema permits', () => {
      const schema = z.string().nullable()
      const result = validateInput(null, schema, 'testInput', { allowNull: true })
      expect(result).toBeNull()
    })

    it('should allow undefined when schema permits', () => {
      const schema = z.string().optional()
      const result = validateInput(undefined, schema, 'testInput', { allowUndefined: true })
      expect(result).toBeUndefined()
    })
  })

  describe('validateString', () => {
    it('should throw for null', () => {
      expect(() => validateString(null, 'name')).toThrow(InputValidationError)
      expect(() => validateString(null, 'name')).toThrow('name must be a string')
    })

    it('should throw for undefined', () => {
      expect(() => validateString(undefined, 'name')).toThrow(InputValidationError)
    })

    it('should throw for number', () => {
      expect(() => validateString(123, 'name')).toThrow(InputValidationError)
    })

    it('should throw for object', () => {
      expect(() => validateString({}, 'name')).toThrow(InputValidationError)
    })

    it('should throw for array', () => {
      expect(() => validateString([], 'name')).toThrow(InputValidationError)
    })

    it('should return valid string', () => {
      expect(validateString('hello', 'name')).toBe('hello')
    })

    it('should allow empty string by default', () => {
      expect(validateString('', 'name')).toBe('')
    })
  })

  describe('validateNonEmptyString', () => {
    it('should throw for empty string', () => {
      expect(() => validateNonEmptyString('', 'name')).toThrow(InputValidationError)
      expect(() => validateNonEmptyString('', 'name')).toThrow('name cannot be empty')
    })

    it('should throw for whitespace-only string', () => {
      expect(() => validateNonEmptyString('   ', 'name')).toThrow(InputValidationError)
    })

    it('should return trimmed valid string', () => {
      expect(validateNonEmptyString('  hello  ', 'name')).toBe('hello')
    })
  })

  describe('validateNumber', () => {
    it('should throw for null', () => {
      expect(() => validateNumber(null, 'count')).toThrow(InputValidationError)
      expect(() => validateNumber(null, 'count')).toThrow('count must be a number')
    })

    it('should throw for undefined', () => {
      expect(() => validateNumber(undefined, 'count')).toThrow(InputValidationError)
    })

    it('should throw for string', () => {
      expect(() => validateNumber('123', 'count')).toThrow(InputValidationError)
    })

    it('should throw for NaN', () => {
      expect(() => validateNumber(NaN, 'count')).toThrow(InputValidationError)
    })

    it('should throw for Infinity', () => {
      expect(() => validateNumber(Infinity, 'count')).toThrow(InputValidationError)
    })

    it('should throw for -Infinity', () => {
      expect(() => validateNumber(-Infinity, 'count')).toThrow(InputValidationError)
    })

    it('should return valid number', () => {
      expect(validateNumber(42, 'count')).toBe(42)
    })

    it('should return valid float', () => {
      expect(validateNumber(3.14, 'count')).toBe(3.14)
    })

    it('should return valid negative number', () => {
      expect(validateNumber(-10, 'count')).toBe(-10)
    })

    it('should return zero', () => {
      expect(validateNumber(0, 'count')).toBe(0)
    })

    it('should enforce minimum constraint', () => {
      expect(() => validateNumber(5, 'count', { min: 10 })).toThrow(InputValidationError)
      expect(() => validateNumber(5, 'count', { min: 10 })).toThrow('count must be at least 10')
    })

    it('should enforce maximum constraint', () => {
      expect(() => validateNumber(15, 'count', { max: 10 })).toThrow(InputValidationError)
      expect(() => validateNumber(15, 'count', { max: 10 })).toThrow('count must be at most 10')
    })

    it('should enforce integer constraint', () => {
      expect(() => validateNumber(3.14, 'count', { integer: true })).toThrow(InputValidationError)
      expect(() => validateNumber(3.14, 'count', { integer: true })).toThrow('count must be an integer')
    })
  })

  describe('validateObject', () => {
    it('should throw for null', () => {
      expect(() => validateObject(null, 'options')).toThrow(InputValidationError)
      expect(() => validateObject(null, 'options')).toThrow('options must be an object')
    })

    it('should throw for undefined', () => {
      expect(() => validateObject(undefined, 'options')).toThrow(InputValidationError)
    })

    it('should throw for string', () => {
      expect(() => validateObject('hello', 'options')).toThrow(InputValidationError)
    })

    it('should throw for number', () => {
      expect(() => validateObject(123, 'options')).toThrow(InputValidationError)
    })

    it('should throw for array', () => {
      expect(() => validateObject([], 'options')).toThrow(InputValidationError)
    })

    it('should return valid object', () => {
      const obj = { key: 'value' }
      expect(validateObject(obj, 'options')).toBe(obj)
    })

    it('should return empty object', () => {
      const obj = {}
      expect(validateObject(obj, 'options')).toBe(obj)
    })
  })

  describe('validateArray', () => {
    it('should throw for null', () => {
      expect(() => validateArray(null, 'items')).toThrow(InputValidationError)
      expect(() => validateArray(null, 'items')).toThrow('items must be an array')
    })

    it('should throw for undefined', () => {
      expect(() => validateArray(undefined, 'items')).toThrow(InputValidationError)
    })

    it('should throw for string', () => {
      expect(() => validateArray('hello', 'items')).toThrow(InputValidationError)
    })

    it('should throw for object', () => {
      expect(() => validateArray({}, 'items')).toThrow(InputValidationError)
    })

    it('should return valid array', () => {
      const arr = [1, 2, 3]
      expect(validateArray(arr, 'items')).toBe(arr)
    })

    it('should return empty array', () => {
      const arr: unknown[] = []
      expect(validateArray(arr, 'items')).toBe(arr)
    })

    it('should enforce minimum length', () => {
      expect(() => validateArray([], 'items', { minLength: 1 })).toThrow(InputValidationError)
      expect(() => validateArray([], 'items', { minLength: 1 })).toThrow('items must have at least 1 element')
    })

    it('should enforce maximum length', () => {
      expect(() => validateArray([1, 2, 3], 'items', { maxLength: 2 })).toThrow(InputValidationError)
      expect(() => validateArray([1, 2, 3], 'items', { maxLength: 2 })).toThrow('items must have at most 2 elements')
    })
  })

  describe('validateId', () => {
    it('should throw for null', () => {
      expect(() => validateId(null, 'userId')).toThrow(InputValidationError)
    })

    it('should throw for undefined', () => {
      expect(() => validateId(undefined, 'userId')).toThrow(InputValidationError)
    })

    it('should throw for empty string', () => {
      expect(() => validateId('', 'userId')).toThrow(InputValidationError)
      expect(() => validateId('', 'userId')).toThrow('userId cannot be empty')
    })

    it('should throw for string with only whitespace', () => {
      expect(() => validateId('   ', 'userId')).toThrow(InputValidationError)
    })

    it('should return valid string id', () => {
      expect(validateId('user-123', 'userId')).toBe('user-123')
    })

    it('should return valid uuid', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      expect(validateId(uuid, 'userId')).toBe(uuid)
    })
  })

  describe('validatePath', () => {
    it('should throw for null', () => {
      expect(() => validatePath(null, 'filePath')).toThrow(InputValidationError)
    })

    it('should throw for undefined', () => {
      expect(() => validatePath(undefined, 'filePath')).toThrow(InputValidationError)
    })

    it('should throw for empty string', () => {
      expect(() => validatePath('', 'filePath')).toThrow(InputValidationError)
    })

    it('should throw for path with null bytes', () => {
      expect(() => validatePath('/path/to\x00/file', 'filePath')).toThrow(InputValidationError)
      expect(() => validatePath('/path/to\x00/file', 'filePath')).toThrow('filePath contains invalid characters')
    })

    it('should return valid absolute path', () => {
      expect(validatePath('/path/to/file', 'filePath')).toBe('/path/to/file')
    })

    it('should return valid relative path', () => {
      expect(validatePath('./path/to/file', 'filePath')).toBe('./path/to/file')
    })

    it('should normalize paths with multiple slashes', () => {
      expect(validatePath('/path//to///file', 'filePath')).toBe('/path/to/file')
    })
  })

  describe('validateOptions', () => {
    const optionsSchema = z.object({
      timeout: z.number().optional(),
      retries: z.number().int().min(0).optional(),
      flag: z.boolean().optional(),
    })

    it('should return empty object for undefined', () => {
      expect(validateOptions(undefined, optionsSchema, 'options')).toEqual({})
    })

    it('should return empty object for null when allowed', () => {
      expect(validateOptions(null, optionsSchema, 'options')).toEqual({})
    })

    it('should throw for invalid options', () => {
      expect(() => validateOptions({ timeout: 'fast' }, optionsSchema, 'options')).toThrow(InputValidationError)
    })

    it('should return valid options', () => {
      const opts = { timeout: 1000, retries: 3 }
      expect(validateOptions(opts, optionsSchema, 'options')).toEqual(opts)
    })

    it('should strip unknown keys by default', () => {
      const opts = { timeout: 1000, unknownKey: 'value' }
      expect(validateOptions(opts, optionsSchema, 'options')).toEqual({ timeout: 1000 })
    })
  })

  describe('createInputValidator', () => {
    it('should create a reusable validator', () => {
      const validateUserId = createInputValidator(
        z.string().min(1).max(100),
        'userId'
      )

      expect(validateUserId('user-123')).toBe('user-123')
      expect(() => validateUserId(null)).toThrow(InputValidationError)
      expect(() => validateUserId('')).toThrow(InputValidationError)
    })

    it('should include context in error messages', () => {
      const validateEmail = createInputValidator(
        z.string().email(),
        'email'
      )

      expect(() => validateEmail('not-an-email')).toThrow('email')
    })
  })

  describe('InputValidationError', () => {
    it('should have correct properties', () => {
      const error = new InputValidationError({
        message: 'Test error',
        inputName: 'testInput',
        received: 123,
        expected: 'string',
      })

      expect(error.message).toBe('Test error')
      expect(error.name).toBe('InputValidationError')
      expect(error.inputName).toBe('testInput')
      expect(error.received).toBe(123)
      expect(error.expected).toBe('string')
      expect(error.code).toBe('INPUT_VALIDATION_ERROR')
    })

    it('should format toString() correctly', () => {
      const error = new InputValidationError({
        message: 'must be a string',
        inputName: 'userId',
      })

      expect(error.toString()).toContain('userId')
      expect(error.toString()).toContain('must be a string')
    })

    it('should be serializable to JSON', () => {
      const error = new InputValidationError({
        message: 'must be a string',
        inputName: 'userId',
        received: 123,
        expected: 'string',
      })

      const json = error.toJSON()
      expect(json.message).toBe('must be a string')
      expect(json.inputName).toBe('userId')
      expect(json.expected).toBe('string')
      expect(json.code).toBe('INPUT_VALIDATION_ERROR')
    })
  })
})

describe('Store Input Validation', () => {
  describe('ThingsStore validation', () => {
    it('should validate id parameter for get()', () => {
      // These tests will be wired up to actual store methods
      // For now, testing the validators that will be used
      expect(() => validateId(null, 'id')).toThrow(InputValidationError)
      expect(() => validateId(undefined, 'id')).toThrow(InputValidationError)
      expect(() => validateId('', 'id')).toThrow(InputValidationError)
      expect(() => validateId(123 as unknown as string, 'id')).toThrow(InputValidationError)
    })

    it('should validate data parameter for create()', () => {
      expect(() => validateObject(null, 'data')).toThrow(InputValidationError)
      expect(() => validateObject(undefined, 'data')).toThrow(InputValidationError)
      expect(() => validateObject('string', 'data')).toThrow(InputValidationError)
    })

    it('should validate type field in create data', () => {
      const typeSchema = z.object({
        $type: z.string().min(1),
      })

      expect(() => validateInput({}, typeSchema, 'data')).toThrow(InputValidationError)
      expect(() => validateInput({ $type: '' }, typeSchema, 'data')).toThrow(InputValidationError)
      expect(() => validateInput({ $type: 123 }, typeSchema, 'data')).toThrow(InputValidationError)
    })

    it('should validate options parameter for list()', () => {
      const listOptionsSchema = z.object({
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
        type: z.string().optional(),
        branch: z.string().optional(),
      })

      // Invalid limit
      expect(() => validateOptions({ limit: -1 }, listOptionsSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateOptions({ limit: 0 }, listOptionsSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateOptions({ limit: 10000 }, listOptionsSchema, 'options')).toThrow(InputValidationError)

      // Invalid offset
      expect(() => validateOptions({ offset: -1 }, listOptionsSchema, 'options')).toThrow(InputValidationError)

      // Valid options
      expect(validateOptions({ limit: 100, offset: 0 }, listOptionsSchema, 'options')).toEqual({ limit: 100, offset: 0 })
    })
  })

  describe('RelationshipsStore validation', () => {
    it('should validate create() parameters', () => {
      const createSchema = z.object({
        verb: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        data: z.record(z.unknown()).optional(),
      })

      expect(() => validateInput({ verb: '', from: 'a', to: 'b' }, createSchema, 'data')).toThrow(InputValidationError)
      expect(() => validateInput({ verb: 'owns', from: '', to: 'b' }, createSchema, 'data')).toThrow(InputValidationError)
      expect(() => validateInput({ verb: 'owns', from: 'a', to: '' }, createSchema, 'data')).toThrow(InputValidationError)
    })
  })

  describe('ActionsStore validation', () => {
    it('should validate log() parameters', () => {
      const logSchema = z.object({
        verb: z.string().min(1),
        target: z.string().min(1),
        actor: z.string().optional(),
        input: z.unknown().optional(),
      })

      expect(() => validateInput({ verb: '', target: 'x' }, logSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateInput({ verb: 'run', target: '' }, logSchema, 'options')).toThrow(InputValidationError)
    })
  })

  describe('EventsStore validation', () => {
    it('should validate emit() parameters', () => {
      const emitSchema = z.object({
        verb: z.string().min(1),
        source: z.string().min(1),
        data: z.record(z.unknown()),
      })

      expect(() => validateInput({ verb: '', source: 'x', data: {} }, emitSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateInput({ verb: 'x', source: '', data: {} }, emitSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateInput({ verb: 'x', source: 'y', data: null }, emitSchema, 'options')).toThrow(InputValidationError)
    })
  })

  describe('SearchStore validation', () => {
    it('should validate index() parameters', () => {
      const indexSchema = z.object({
        $id: z.string().min(1),
        $type: z.string().min(1),
        content: z.string(),
      })

      expect(() => validateInput({ $id: '', $type: 'x', content: '' }, indexSchema, 'entry')).toThrow(InputValidationError)
      expect(() => validateInput({ $id: 'x', $type: '', content: '' }, indexSchema, 'entry')).toThrow(InputValidationError)
    })

    it('should validate query() parameters', () => {
      expect(() => validateNonEmptyString(null, 'query')).toThrow(InputValidationError)
      expect(() => validateNonEmptyString('', 'query')).toThrow(InputValidationError)
      expect(() => validateNonEmptyString('   ', 'query')).toThrow(InputValidationError)
    })
  })

  describe('ObjectsStore validation', () => {
    it('should validate register() parameters', () => {
      const registerSchema = z.object({
        ns: z.string().min(1),
        id: z.string().min(1),
        class: z.string().min(1),
      })

      expect(() => validateInput({ ns: '', id: 'x', class: 'y' }, registerSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateInput({ ns: 'x', id: '', class: 'y' }, registerSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateInput({ ns: 'x', id: 'y', class: '' }, registerSchema, 'options')).toThrow(InputValidationError)
    })

    it('should validate get() namespace parameter', () => {
      expect(() => validateNonEmptyString(null, 'ns')).toThrow(InputValidationError)
      expect(() => validateNonEmptyString('', 'ns')).toThrow(InputValidationError)
    })
  })

  describe('DLQStore validation', () => {
    it('should validate add() parameters', () => {
      const addSchema = z.object({
        verb: z.string().min(1),
        source: z.string().min(1),
        data: z.record(z.unknown()),
        error: z.string().min(1),
      })

      expect(() => validateInput({ verb: '', source: 'x', data: {}, error: 'y' }, addSchema, 'options')).toThrow(InputValidationError)
    })
  })
})

describe('Primitive Input Validation', () => {
  describe('fsx validation', () => {
    it('should validate path for readFile()', () => {
      expect(() => validatePath(null, 'path')).toThrow(InputValidationError)
      expect(() => validatePath(undefined, 'path')).toThrow(InputValidationError)
      expect(() => validatePath('', 'path')).toThrow(InputValidationError)
      expect(() => validatePath(123 as unknown as string, 'path')).toThrow(InputValidationError)
    })

    it('should validate path for writeFile()', () => {
      expect(() => validatePath(null, 'path')).toThrow(InputValidationError)
    })

    it('should validate content for writeFile()', () => {
      // Content can be string or Uint8Array
      const contentSchema = z.union([z.string(), z.instanceof(Uint8Array)])
      expect(() => validateInput(null, contentSchema, 'content')).toThrow(InputValidationError)
      expect(() => validateInput(123, contentSchema, 'content')).toThrow(InputValidationError)
    })

    it('should validate options for mkdir()', () => {
      const mkdirOptionsSchema = z.object({
        recursive: z.boolean().optional(),
        mode: z.number().int().optional(),
      })

      expect(validateOptions({}, mkdirOptionsSchema, 'options')).toEqual({})
      expect(validateOptions({ recursive: true }, mkdirOptionsSchema, 'options')).toEqual({ recursive: true })
      expect(() => validateOptions({ recursive: 'yes' }, mkdirOptionsSchema, 'options')).toThrow(InputValidationError)
    })
  })

  describe('bashx validation', () => {
    it('should validate command input', () => {
      expect(() => validateNonEmptyString(null, 'command')).toThrow(InputValidationError)
      expect(() => validateNonEmptyString('', 'command')).toThrow(InputValidationError)
    })

    it('should validate options', () => {
      const bashOptionsSchema = z.object({
        cwd: z.string().optional(),
        timeout: z.number().int().positive().optional(),
        confirm: z.boolean().optional(),
      })

      expect(validateOptions({ timeout: 5000 }, bashOptionsSchema, 'options')).toEqual({ timeout: 5000 })
      expect(() => validateOptions({ timeout: -1 }, bashOptionsSchema, 'options')).toThrow(InputValidationError)
      expect(() => validateOptions({ timeout: 0 }, bashOptionsSchema, 'options')).toThrow(InputValidationError)
    })
  })

  describe('npmx validation', () => {
    it('should validate packages array for install()', () => {
      expect(validateArray([], 'packages')).toEqual([])
      expect(validateArray(['lodash'], 'packages')).toEqual(['lodash'])
      expect(() => validateArray(null, 'packages')).toThrow(InputValidationError)
      expect(() => validateArray('lodash', 'packages')).toThrow(InputValidationError)
    })

    it('should validate package name format', () => {
      const packageNameSchema = z.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@.+)?$/)

      expect(() => validateInput('', packageNameSchema, 'package')).toThrow(InputValidationError)
      expect(() => validateInput('INVALID', packageNameSchema, 'package')).toThrow(InputValidationError)
      expect(validateInput('lodash', packageNameSchema, 'package')).toBe('lodash')
      expect(validateInput('@types/node', packageNameSchema, 'package')).toBe('@types/node')
      expect(validateInput('react@18', packageNameSchema, 'package')).toBe('react@18')
    })
  })

  describe('pyx validation', () => {
    it('should validate code for exec()', () => {
      expect(() => validateNonEmptyString(null, 'code')).toThrow(InputValidationError)
      expect(() => validateNonEmptyString('', 'code')).toThrow(InputValidationError)
    })

    it('should validate options for exec()', () => {
      const execOptionsSchema = z.object({
        timeout: z.number().int().positive().optional(),
        packages: z.array(z.string()).optional(),
      })

      expect(validateOptions({ timeout: 30000 }, execOptionsSchema, 'options')).toEqual({ timeout: 30000 })
      expect(() => validateOptions({ timeout: -1 }, execOptionsSchema, 'options')).toThrow(InputValidationError)
    })

    it('should validate packages array', () => {
      const packagesSchema = z.array(z.string().min(1))

      expect(() => validateInput(['numpy', ''], packagesSchema, 'packages')).toThrow(InputValidationError)
      expect(validateInput(['numpy', 'pandas'], packagesSchema, 'packages')).toEqual(['numpy', 'pandas'])
    })
  })
})
