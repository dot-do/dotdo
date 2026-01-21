/**
 * Tests for AI-Generated Field Support
 *
 * Tests the ai-fields module functionality including:
 * - Building AI prompts with context
 * - Generating single field values
 * - Generating all fields for an entity
 * - Utility functions for field detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildAIPrompt,
  generateFieldValue,
  generateFieldValueWithResult,
  generateAllFields,
  generateAllFieldsSimple,
  getFieldsNeedingGeneration,
  hasGeneratedFields,
  getGeneratedFieldDefinitions,
  type AIGenerationContext,
  type AIGenerateFunction,
  type AIFieldOptions,
} from '../schema/ai-fields'
import { parseEntitySchema } from '../schema/parser'
import type { FieldDefinition, EntitySchema } from '../schema/types'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockAIGenerate(responses: Record<string, string> = {}): AIGenerateFunction {
  return async (prompt: string, context: AIGenerationContext): Promise<string> => {
    // Return mock response based on field name
    const response = responses[context.fieldName]
    if (response !== undefined) {
      return response
    }
    // Default: return a generated value based on field name
    return `Generated ${context.fieldName} for ${context.entityType}`
  }
}

function createPromptField(name: string, prompt: string): FieldDefinition {
  return {
    name,
    type: 'string',
    modifier: '',
    required: false,
    optional: true,
    indexed: false,
    unique: false,
    array: false,
    prompt,
    generated: true,
  }
}

function createRegularField(name: string, type: string): FieldDefinition {
  return {
    name,
    type,
    modifier: '!',
    required: true,
    optional: false,
    indexed: false,
    unique: false,
    array: false,
    generated: false,
  }
}

// =============================================================================
// buildAIPrompt Tests
// =============================================================================

describe('buildAIPrompt', () => {
  it('should build prompt with entity context', () => {
    const context: AIGenerationContext = {
      entityType: 'Product',
      fieldName: 'description',
      entityData: { name: 'Widget', price: 29.99 },
    }

    const prompt = buildAIPrompt('A compelling product description', context)

    expect(prompt).toContain('Generate the "description" field for a Product entity')
    expect(prompt).toContain('Field description: A compelling product description')
    expect(prompt).toContain('name: "Widget"')
    expect(prompt).toContain('price: 29.99')
    expect(prompt).toContain('Generate only the field value')
  })

  it('should include instructions when provided', () => {
    const context: AIGenerationContext = {
      entityType: 'Product',
      fieldName: 'description',
      entityData: { name: 'Widget' },
      instructions: 'Write in a friendly tone',
    }

    const prompt = buildAIPrompt('A product description', context)

    expect(prompt).toContain('Instructions: Write in a friendly tone')
  })

  it('should exclude system fields starting with $', () => {
    const context: AIGenerationContext = {
      entityType: 'Product',
      fieldName: 'description',
      entityData: {
        name: 'Widget',
        $id: 'prod-123',
        $type: 'Product',
      },
    }

    const prompt = buildAIPrompt('A product description', context)

    expect(prompt).toContain('name: "Widget"')
    expect(prompt).not.toContain('$id')
    expect(prompt).not.toContain('$type')
  })

  it('should handle empty entity data', () => {
    const context: AIGenerationContext = {
      entityType: 'Product',
      fieldName: 'description',
      entityData: {},
    }

    const prompt = buildAIPrompt('A product description', context)

    expect(prompt).toContain('Generate the "description" field')
    expect(prompt).not.toContain('Entity data:')
  })
})

// =============================================================================
// generateFieldValue Tests
// =============================================================================

describe('generateFieldValue', () => {
  it('should generate value for prompt field', async () => {
    const fieldDef = createPromptField('description', 'A compelling product description')
    const entityData = { name: 'Widget' }
    const mockGenerate = createMockAIGenerate({
      description: 'The Widget is an innovative solution...',
    })

    const result = await generateFieldValue(fieldDef, entityData, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result).toBe('The Widget is an innovative solution...')
  })

  it('should return undefined for non-prompt field', async () => {
    const fieldDef = createRegularField('name', 'string')
    const mockGenerate = vi.fn()

    const result = await generateFieldValue(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result).toBeUndefined()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('should return undefined when field has no prompt', async () => {
    const fieldDef: FieldDefinition = {
      name: 'description',
      type: 'string',
      modifier: '',
      required: false,
      optional: true,
      indexed: false,
      unique: false,
      array: false,
      generated: true, // generated but no prompt
    }
    const mockGenerate = vi.fn()

    const result = await generateFieldValue(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result).toBeUndefined()
  })

  it('should pass directives to context', async () => {
    const fieldDef = createPromptField('description', 'A product description')
    let capturedContext: AIGenerationContext | null = null
    const mockGenerate: AIGenerateFunction = async (_prompt, context) => {
      capturedContext = context
      return 'Generated value'
    }

    await generateFieldValue(fieldDef, { name: 'Widget' }, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
      directives: {
        $instructions: 'Be concise',
        $fuzzyThreshold: 0.8,
      },
    })

    expect(capturedContext).not.toBeNull()
    expect(capturedContext!.instructions).toBe('Be concise')
    expect(capturedContext!.fuzzyThreshold).toBe(0.8)
  })

  it('should return undefined on generation error without throwing', async () => {
    const fieldDef = createPromptField('description', 'A product description')
    const mockGenerate: AIGenerateFunction = async () => {
      throw new Error('AI service unavailable')
    }

    // Should not throw
    const result = await generateFieldValue(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result).toBeUndefined()
  })
})

// =============================================================================
// generateFieldValueWithResult Tests
// =============================================================================

describe('generateFieldValueWithResult', () => {
  it('should return success result for generated field', async () => {
    const fieldDef = createPromptField('description', 'A product description')
    const mockGenerate = createMockAIGenerate({
      description: 'Great product!',
    })

    const result = await generateFieldValueWithResult(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.fieldName).toBe('description')
    expect(result.value).toBe('Great product!')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should return failure result for non-prompt field', async () => {
    const fieldDef = createRegularField('name', 'string')
    const mockGenerate = vi.fn()

    const result = await generateFieldValueWithResult(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.fieldName).toBe('name')
    expect(result.value).toBeUndefined()
    expect(result.success).toBe(false)
    expect(result.error).toBe('Field is not a generated/prompt field')
  })

  it('should return failure result with error message on generation error', async () => {
    const fieldDef = createPromptField('description', 'A product description')
    const mockGenerate: AIGenerateFunction = async () => {
      throw new Error('Service unavailable')
    }

    const result = await generateFieldValueWithResult(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.fieldName).toBe('description')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Service unavailable')
  })

  it('should return failure when AI returns empty value', async () => {
    const fieldDef = createPromptField('description', 'A product description')
    const mockGenerate: AIGenerateFunction = async () => ''

    const result = await generateFieldValueWithResult(fieldDef, {}, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('AI returned empty value')
  })
})

// =============================================================================
// getFieldsNeedingGeneration Tests
// =============================================================================

describe('getFieldsNeedingGeneration', () => {
  it('should return prompt fields without values', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A compelling product description',
      seoKeywords: 'SEO keywords for search',
    })

    const fields = getFieldsNeedingGeneration(schema, { name: 'Widget' })

    expect(fields.size).toBe(2)
    expect(fields.has('description')).toBe(true)
    expect(fields.has('seoKeywords')).toBe(true)
    expect(fields.has('name')).toBe(false)
  })

  it('should skip fields that already have values', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A compelling product description',
      seoKeywords: 'SEO keywords for search',
    })

    const fields = getFieldsNeedingGeneration(schema, {
      name: 'Widget',
      description: 'Pre-existing description',
    })

    expect(fields.size).toBe(1)
    expect(fields.has('seoKeywords')).toBe(true)
    expect(fields.has('description')).toBe(false)
  })

  it('should return empty map when no prompt fields', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      price: 'decimal(10,2)',
    })

    const fields = getFieldsNeedingGeneration(schema, {})

    expect(fields.size).toBe(0)
  })

  it('should return empty map when all prompt fields have values', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
    })

    const fields = getFieldsNeedingGeneration(schema, {
      name: 'Widget',
      description: 'Already provided',
    })

    expect(fields.size).toBe(0)
  })
})

// =============================================================================
// generateAllFields Tests
// =============================================================================

describe('generateAllFields', () => {
  it('should generate all missing prompt fields', async () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A compelling product description',
      tagline: 'A short catchy tagline',
    })

    const mockGenerate = createMockAIGenerate({
      description: 'Widget is the best tool ever!',
      tagline: 'Widget: Simply the best.',
    })

    const result = await generateAllFields(schema, { name: 'Widget' }, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.data.name).toBe('Widget')
    expect(result.data.description).toBe('Widget is the best tool ever!')
    expect(result.data.tagline).toBe('Widget: Simply the best.')
    expect(result.successCount).toBe(2)
    expect(result.failureCount).toBe(0)
    expect(result.results).toHaveLength(2)
  })

  it('should not overwrite existing values', async () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
    })

    const mockGenerate = createMockAIGenerate({
      description: 'AI generated description',
    })

    const result = await generateAllFields(
      schema,
      { name: 'Widget', description: 'User provided description' },
      { aiGenerate: mockGenerate, entityType: 'Product' }
    )

    expect(result.data.description).toBe('User provided description')
    expect(result.successCount).toBe(0)
    expect(result.results).toHaveLength(0)
  })

  it('should handle mixed success and failure', async () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
      tagline: 'A short tagline',
    })

    const mockGenerate: AIGenerateFunction = async (_prompt, context) => {
      if (context.fieldName === 'description') {
        return 'Generated description'
      }
      throw new Error('Failed to generate')
    }

    const result = await generateAllFields(schema, { name: 'Widget' }, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.data.description).toBe('Generated description')
    expect(result.data.tagline).toBeUndefined()
    expect(result.successCount).toBe(1)
    expect(result.failureCount).toBe(1)
  })

  it('should use schema directives for context', async () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
      $instructions: 'Write in a professional tone',
      $fuzzyThreshold: 0.9,
    })

    let capturedContext: AIGenerationContext | null = null
    const mockGenerate: AIGenerateFunction = async (_prompt, context) => {
      capturedContext = context
      return 'Generated value'
    }

    await generateAllFields(schema, { name: 'Widget' }, {
      aiGenerate: mockGenerate,
    })

    expect(capturedContext).not.toBeNull()
    expect(capturedContext!.instructions).toBe('Write in a professional tone')
    expect(capturedContext!.fuzzyThreshold).toBe(0.9)
  })

  it('should return original data when no fields need generation', async () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      price: 'decimal(10,2)',
    })

    const mockGenerate = vi.fn()
    const entityData = { name: 'Widget', price: 29.99 }

    const result = await generateAllFields(schema, entityData, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(result.data).toEqual(entityData)
    expect(result.successCount).toBe(0)
    expect(result.failureCount).toBe(0)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

// =============================================================================
// generateAllFieldsSimple Tests
// =============================================================================

describe('generateAllFieldsSimple', () => {
  it('should return just the data object', async () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
    })

    const mockGenerate = createMockAIGenerate({
      description: 'Generated description',
    })

    const data = await generateAllFieldsSimple(schema, { name: 'Widget' }, {
      aiGenerate: mockGenerate,
      entityType: 'Product',
    })

    expect(data.name).toBe('Widget')
    expect(data.description).toBe('Generated description')
    // No results, successCount, etc. - just the data
    expect(data).not.toHaveProperty('results')
    expect(data).not.toHaveProperty('successCount')
  })
})

// =============================================================================
// hasGeneratedFields Tests
// =============================================================================

describe('hasGeneratedFields', () => {
  it('should return true when schema has prompt fields', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
    })

    expect(hasGeneratedFields(schema)).toBe(true)
  })

  it('should return false when schema has no prompt fields', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      price: 'decimal(10,2)',
    })

    expect(hasGeneratedFields(schema)).toBe(false)
  })

  it('should return false for empty schema', () => {
    const schema = parseEntitySchema('Empty', {})

    expect(hasGeneratedFields(schema)).toBe(false)
  })
})

// =============================================================================
// getGeneratedFieldDefinitions Tests
// =============================================================================

describe('getGeneratedFieldDefinitions', () => {
  it('should return array of generated field definitions', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      description: 'A product description',
      tagline: 'A short tagline',
      price: 'decimal(10,2)',
    })

    const generatedFields = getGeneratedFieldDefinitions(schema)

    expect(generatedFields).toHaveLength(2)
    expect(generatedFields.map(f => f.name).sort()).toEqual(['description', 'tagline'])
    expect(generatedFields.every(f => f.generated)).toBe(true)
    expect(generatedFields.every(f => f.prompt)).toBe(true)
  })

  it('should return empty array when no generated fields', () => {
    const schema = parseEntitySchema('Product', {
      name: 'string!',
      price: 'decimal(10,2)',
    })

    const generatedFields = getGeneratedFieldDefinitions(schema)

    expect(generatedFields).toHaveLength(0)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('AI Fields Integration', () => {
  it('should work with full entity creation flow', async () => {
    // Define schema with mix of regular and AI fields
    const schema = parseEntitySchema('Product', {
      sku: 'string!#',
      name: 'string!',
      price: 'decimal(10,2)!',
      description: 'A compelling marketing description for e-commerce',
      seoKeywords: 'SEO keywords to help with search rankings',
      $instructions: 'Generate engaging e-commerce content',
    })

    // User provides only required fields
    const userData = {
      sku: 'WIDGET-001',
      name: 'Premium Widget',
      price: 49.99,
    }

    // Mock AI to generate content
    const mockGenerate = createMockAIGenerate({
      description: 'The Premium Widget is a state-of-the-art tool designed for professionals.',
      seoKeywords: 'premium widget, professional tool, quality gadget',
    })

    // Generate AI fields
    const result = await generateAllFields(schema, userData, {
      aiGenerate: mockGenerate,
    })

    // Verify complete entity data
    expect(result.data).toEqual({
      sku: 'WIDGET-001',
      name: 'Premium Widget',
      price: 49.99,
      description: 'The Premium Widget is a state-of-the-art tool designed for professionals.',
      seoKeywords: 'premium widget, professional tool, quality gadget',
    })

    // Verify generation metadata
    expect(result.successCount).toBe(2)
    expect(result.failureCount).toBe(0)
  })

  it('should handle schema with relations and AI fields', async () => {
    const schema = parseEntitySchema('Post', {
      title: 'string!',
      content: 'text!',
      summary: 'A brief summary of the post content',
      author: '-> User',
    })

    const mockGenerate = createMockAIGenerate({
      summary: 'This post discusses interesting topics.',
    })

    const result = await generateAllFields(
      schema,
      { title: 'My Post', content: 'Long content here...', author: 'user-123' },
      { aiGenerate: mockGenerate }
    )

    expect(result.data.summary).toBe('This post discusses interesting topics.')
    expect(result.data.author).toBe('user-123') // Relation field unchanged
    expect(result.successCount).toBe(1)
  })
})
