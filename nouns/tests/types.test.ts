import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineNoun, Collection, type Noun, type AnyNoun } from '../types'

/**
 * RED Phase Tests for Noun TYPE SYSTEM validation
 *
 * These tests verify the Noun type system including:
 * - defineNoun() function creates valid Noun objects
 * - Schema type inference is preserved
 * - Collection() creates array schema from noun
 * - AnyNoun type compatibility
 * - Noun inheritance via extends field
 * - Default values application
 *
 * Some tests may fail, exposing type issues that need fixing.
 */

// ============================================================================
// Test Schemas - Define schemas for testing
// ============================================================================

const SimpleSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Simple'),
  name: z.string(),
})
type SimpleType = z.infer<typeof SimpleSchema>

const ExtendedSchema = SimpleSchema.extend({
  $type: z.literal('https://schema.org.ai/Extended'),
  extra: z.string(),
  count: z.number().optional(),
})
type ExtendedType = z.infer<typeof ExtendedSchema>

const ComplexSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Complex'),
  name: z.string(),
  tags: z.array(z.string()),
  nested: z.object({
    inner: z.string(),
    value: z.number(),
  }),
  status: z.enum(['active', 'inactive', 'pending']),
})
type ComplexType = z.infer<typeof ComplexSchema>

// ============================================================================
// defineNoun() - Creates valid Noun objects
// ============================================================================

describe('defineNoun() creates valid Noun objects', () => {
  describe('basic Noun creation', () => {
    it('creates a Noun with required fields', () => {
      const noun = defineNoun({
        noun: 'Simple',
        plural: 'Simples',
        $type: 'https://schema.org.ai/Simple',
        schema: SimpleSchema,
      })

      expect(noun).toBeDefined()
      expect(noun.noun).toBe('Simple')
      expect(noun.plural).toBe('Simples')
      expect(noun.$type).toBe('https://schema.org.ai/Simple')
      expect(noun.schema).toBe(SimpleSchema)
    })

    it('preserves all properties passed to defineNoun', () => {
      const noun = defineNoun({
        noun: 'Test',
        plural: 'Tests',
        $type: 'https://schema.org.ai/Test',
        schema: SimpleSchema,
        extends: 'Thing',
        okrs: ['Revenue', 'Growth'],
        defaults: { name: 'Default Name' },
      })

      expect(noun.extends).toBe('Thing')
      expect(noun.okrs).toEqual(['Revenue', 'Growth'])
      expect(noun.defaults).toEqual({ name: 'Default Name' })
    })

    it('creates immutable Noun (identity function)', () => {
      const config = {
        noun: 'Simple',
        plural: 'Simples',
        $type: 'https://schema.org.ai/Simple',
        schema: SimpleSchema,
      }
      const noun = defineNoun(config)

      // defineNoun should return the same object reference
      expect(noun).toBe(config)
    })
  })

  describe('Noun with complex schemas', () => {
    it('handles schema with nested objects', () => {
      const noun = defineNoun({
        noun: 'Complex',
        plural: 'Complexes',
        $type: 'https://schema.org.ai/Complex',
        schema: ComplexSchema,
      })

      expect(noun.schema).toBe(ComplexSchema)

      // Validate that the schema works
      const valid: ComplexType = {
        $id: 'test-1',
        $type: 'https://schema.org.ai/Complex',
        name: 'Test',
        tags: ['a', 'b'],
        nested: { inner: 'value', value: 42 },
        status: 'active',
      }
      expect(noun.schema.safeParse(valid).success).toBe(true)
    })

    it('handles schema with enums', () => {
      const EnumSchema = z.object({
        $id: z.string(),
        $type: z.literal('https://schema.org.ai/Enum'),
        status: z.enum(['draft', 'published', 'archived']),
        priority: z.enum(['low', 'medium', 'high', 'critical']),
      })

      const noun = defineNoun({
        noun: 'Enumerated',
        plural: 'Enumerateds',
        $type: 'https://schema.org.ai/Enum',
        schema: EnumSchema,
      })

      expect(noun.schema).toBe(EnumSchema)
    })

    it('handles schema with optional fields', () => {
      const OptionalSchema = z.object({
        $id: z.string(),
        $type: z.literal('https://schema.org.ai/Optional'),
        required: z.string(),
        optional: z.string().optional(),
        nullable: z.string().nullable(),
        defaulted: z.string().default('default'),
      })

      const noun = defineNoun({
        noun: 'Optional',
        plural: 'Optionals',
        $type: 'https://schema.org.ai/Optional',
        schema: OptionalSchema,
      })

      // Valid without optional fields
      const valid = {
        $id: 'test-1',
        $type: 'https://schema.org.ai/Optional',
        required: 'required',
        nullable: null,
      }
      expect(noun.schema.safeParse(valid).success).toBe(true)
    })
  })
})

// ============================================================================
// defineNoun() - Preserves schema type inference
// ============================================================================

describe('defineNoun() preserves schema type inference', () => {
  it('infers correct type from simple schema', () => {
    const noun = defineNoun({
      noun: 'Simple',
      plural: 'Simples',
      $type: 'https://schema.org.ai/Simple',
      schema: SimpleSchema,
    })

    // Type inference test - this should compile
    type InferredType = z.infer<typeof noun.schema>

    // The inferred type should match our expected type
    expectTypeOf<InferredType>().toEqualTypeOf<SimpleType>()
  })

  it('infers correct type from extended schema', () => {
    const noun = defineNoun({
      noun: 'Extended',
      plural: 'Extendeds',
      $type: 'https://schema.org.ai/Extended',
      schema: ExtendedSchema,
    })

    type InferredType = z.infer<typeof noun.schema>
    expectTypeOf<InferredType>().toEqualTypeOf<ExtendedType>()
  })

  it('infers correct type from complex schema', () => {
    const noun = defineNoun({
      noun: 'Complex',
      plural: 'Complexes',
      $type: 'https://schema.org.ai/Complex',
      schema: ComplexSchema,
    })

    type InferredType = z.infer<typeof noun.schema>
    expectTypeOf<InferredType>().toEqualTypeOf<ComplexType>()
  })

  it('preserves literal types in schema', () => {
    const LiteralSchema = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Literal'),
      kind: z.literal('specific'),
    })

    const noun = defineNoun({
      noun: 'Literal',
      plural: 'Literals',
      $type: 'https://schema.org.ai/Literal',
      schema: LiteralSchema,
    })

    type InferredType = z.infer<typeof noun.schema>

    // The kind field should be narrowed to 'specific', not string
    expectTypeOf<InferredType['kind']>().toEqualTypeOf<'specific'>()
  })

  it('preserves union types in schema', () => {
    const UnionSchema = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Union'),
      status: z.union([z.literal('a'), z.literal('b'), z.literal('c')]),
    })

    const noun = defineNoun({
      noun: 'Union',
      plural: 'Unions',
      $type: 'https://schema.org.ai/Union',
      schema: UnionSchema,
    })

    type InferredType = z.infer<typeof noun.schema>

    // The status field should be narrowed to 'a' | 'b' | 'c'
    expectTypeOf<InferredType['status']>().toEqualTypeOf<'a' | 'b' | 'c'>()
  })

  it('preserves array element types', () => {
    const ArraySchema = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Array'),
      items: z.array(z.object({ name: z.string(), value: z.number() })),
    })

    const noun = defineNoun({
      noun: 'Array',
      plural: 'Arrays',
      $type: 'https://schema.org.ai/Array',
      schema: ArraySchema,
    })

    type InferredType = z.infer<typeof noun.schema>
    type ItemType = InferredType['items'][number]

    expectTypeOf<ItemType>().toEqualTypeOf<{ name: string; value: number }>()
  })
})

// ============================================================================
// Collection() - Creates array schema from noun
// ============================================================================

describe('Collection() creates array schema from noun', () => {
  const SimpleNoun = defineNoun({
    noun: 'Simple',
    plural: 'Simples',
    $type: 'https://schema.org.ai/Simple',
    schema: SimpleSchema,
  })

  it('creates a collection from a noun', () => {
    const collection = Collection(SimpleNoun)

    expect(collection).toBeDefined()
    expect(collection.noun).toBe('Simples') // Uses plural
    expect(collection.plural).toBe('Simples')
    expect(collection.$type).toBe('https://schema.org/Collection')
  })

  it('creates an array schema from noun schema', () => {
    const collection = Collection(SimpleNoun)

    // The collection schema should be z.array(SimpleSchema)
    const validArray: SimpleType[] = [
      { $id: 'test-1', $type: 'https://schema.org.ai/Simple', name: 'One' },
      { $id: 'test-2', $type: 'https://schema.org.ai/Simple', name: 'Two' },
    ]

    const result = collection.schema.safeParse(validArray)
    expect(result.success).toBe(true)
  })

  it('validates array items against noun schema', () => {
    const collection = Collection(SimpleNoun)

    // Invalid: items don't match SimpleSchema
    const invalidArray = [
      { $id: 'test-1', name: 'One' }, // Missing $type
      { $id: 'test-2', $type: 'wrong', name: 'Two' }, // Wrong $type
    ]

    const result = collection.schema.safeParse(invalidArray)
    expect(result.success).toBe(false)
  })

  it('accepts empty array', () => {
    const collection = Collection(SimpleNoun)

    const result = collection.schema.safeParse([])
    expect(result.success).toBe(true)
  })

  it('rejects non-array input', () => {
    const collection = Collection(SimpleNoun)

    expect(collection.schema.safeParse(null).success).toBe(false)
    expect(collection.schema.safeParse(undefined).success).toBe(false)
    expect(collection.schema.safeParse('string').success).toBe(false)
    expect(collection.schema.safeParse({}).success).toBe(false)
    expect(collection.schema.safeParse(123).success).toBe(false)
  })
})

// ============================================================================
// Collection() - Preserves itemType reference
// ============================================================================

describe('Collection() preserves itemType reference', () => {
  const SimpleNoun = defineNoun({
    noun: 'Simple',
    plural: 'Simples',
    $type: 'https://schema.org.ai/Simple',
    schema: SimpleSchema,
  })

  const ComplexNoun = defineNoun({
    noun: 'Complex',
    plural: 'Complexes',
    $type: 'https://schema.org.ai/Complex',
    schema: ComplexSchema,
  })

  it('has itemType property referencing original noun', () => {
    const collection = Collection(SimpleNoun)

    expect(collection.itemType).toBeDefined()
    expect(collection.itemType).toBe(SimpleNoun)
  })

  it('itemType has all original noun properties', () => {
    const collection = Collection(SimpleNoun)

    expect(collection.itemType.noun).toBe('Simple')
    expect(collection.itemType.plural).toBe('Simples')
    expect(collection.itemType.$type).toBe('https://schema.org.ai/Simple')
    expect(collection.itemType.schema).toBe(SimpleSchema)
  })

  it('itemType schema can validate individual items', () => {
    const collection = Collection(SimpleNoun)

    const validItem: SimpleType = {
      $id: 'test-1',
      $type: 'https://schema.org.ai/Simple',
      name: 'Test',
    }

    const result = collection.itemType.schema.safeParse(validItem)
    expect(result.success).toBe(true)
  })

  it('works with complex nouns', () => {
    const collection = Collection(ComplexNoun)

    expect(collection.itemType).toBe(ComplexNoun)
    expect(collection.noun).toBe('Complexes')
  })

  it('type inference works for itemType', () => {
    const collection = Collection(SimpleNoun)

    type ItemNounType = typeof collection.itemType
    type InferredItemSchema = z.infer<ItemNounType['schema']>

    expectTypeOf<InferredItemSchema>().toEqualTypeOf<SimpleType>()
  })
})

// ============================================================================
// AnyNoun type compatibility with specific nouns
// ============================================================================

describe('AnyNoun type compatibility with specific nouns', () => {
  it('specific Noun is assignable to AnyNoun', () => {
    const specificNoun = defineNoun({
      noun: 'Specific',
      plural: 'Specifics',
      $type: 'https://schema.org.ai/Specific',
      schema: SimpleSchema,
    })

    // This should compile - AnyNoun should accept any Noun
    const anyNoun: AnyNoun = specificNoun
    expect(anyNoun.noun).toBe('Specific')
  })

  it('Noun with different schemas assignable to AnyNoun', () => {
    const simpleNoun = defineNoun({
      noun: 'Simple',
      plural: 'Simples',
      $type: 'https://schema.org.ai/Simple',
      schema: SimpleSchema,
    })

    const complexNoun = defineNoun({
      noun: 'Complex',
      plural: 'Complexes',
      $type: 'https://schema.org.ai/Complex',
      schema: ComplexSchema,
    })

    // Both should be assignable to AnyNoun
    const nouns: AnyNoun[] = [simpleNoun, complexNoun]

    expect(nouns).toHaveLength(2)
    expect(nouns[0].noun).toBe('Simple')
    expect(nouns[1].noun).toBe('Complex')
  })

  it('AnyNoun can be used in generic contexts', () => {
    function getNounName(noun: AnyNoun): string {
      return noun.noun
    }

    const noun = defineNoun({
      noun: 'Test',
      plural: 'Tests',
      $type: 'https://schema.org.ai/Test',
      schema: SimpleSchema,
    })

    expect(getNounName(noun)).toBe('Test')
  })

  it('AnyNoun array can hold mixed noun types', () => {
    const registry: AnyNoun[] = []

    registry.push(
      defineNoun({
        noun: 'First',
        plural: 'Firsts',
        $type: 'https://schema.org.ai/First',
        schema: SimpleSchema,
      }),
    )

    registry.push(
      defineNoun({
        noun: 'Second',
        plural: 'Seconds',
        $type: 'https://schema.org.ai/Second',
        schema: ExtendedSchema,
      }),
    )

    registry.push(
      defineNoun({
        noun: 'Third',
        plural: 'Thirds',
        $type: 'https://schema.org.ai/Third',
        schema: ComplexSchema,
      }),
    )

    expect(registry).toHaveLength(3)
    expect(registry.map((n) => n.noun)).toEqual(['First', 'Second', 'Third'])
  })

  it('AnyNoun schema is accessible but loses specific type info', () => {
    const noun = defineNoun({
      noun: 'Test',
      plural: 'Tests',
      $type: 'https://schema.org.ai/Test',
      schema: SimpleSchema,
    })

    const anyNoun: AnyNoun = noun

    // Schema is still accessible
    expect(anyNoun.schema).toBe(SimpleSchema)

    // But type inference is widened to z.ZodType
    // This is expected - we lose type specificity with AnyNoun
    const result = anyNoun.schema.safeParse({
      $id: 'test',
      $type: 'https://schema.org.ai/Simple',
      name: 'Test',
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Noun inheritance via extends field
// ============================================================================

describe('Noun inheritance via extends field', () => {
  it('defines extends field for parent relationship', () => {
    const childNoun = defineNoun({
      noun: 'Child',
      plural: 'Children',
      $type: 'https://schema.org.ai/Child',
      schema: ExtendedSchema,
      extends: 'Parent',
    })

    expect(childNoun.extends).toBe('Parent')
  })

  it('extends field is optional', () => {
    const rootNoun = defineNoun({
      noun: 'Root',
      plural: 'Roots',
      $type: 'https://schema.org.ai/Root',
      schema: SimpleSchema,
    })

    expect(rootNoun.extends).toBeUndefined()
  })

  it('supports multi-level inheritance chain', () => {
    const base = defineNoun({
      noun: 'Base',
      plural: 'Bases',
      $type: 'https://schema.org.ai/Base',
      schema: SimpleSchema,
    })

    const middle = defineNoun({
      noun: 'Middle',
      plural: 'Middles',
      $type: 'https://schema.org.ai/Middle',
      schema: ExtendedSchema,
      extends: 'Base',
    })

    const leaf = defineNoun({
      noun: 'Leaf',
      plural: 'Leaves',
      $type: 'https://schema.org.ai/Leaf',
      schema: ComplexSchema,
      extends: 'Middle',
    })

    expect(base.extends).toBeUndefined()
    expect(middle.extends).toBe('Base')
    expect(leaf.extends).toBe('Middle')
  })

  it('extends is just metadata - no runtime behavior', () => {
    // Note: extends is purely metadata; the type system uses Zod schema extension
    const ParentSchema = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Parent'),
      parentField: z.string(),
    })

    const ChildSchema = ParentSchema.omit({ $type: true }).extend({
      $type: z.literal('https://schema.org.ai/Child'),
      childField: z.string(),
    })

    const parent = defineNoun({
      noun: 'Parent',
      plural: 'Parents',
      $type: 'https://schema.org.ai/Parent',
      schema: ParentSchema,
    })

    const child = defineNoun({
      noun: 'Child',
      plural: 'Children',
      $type: 'https://schema.org.ai/Child',
      schema: ChildSchema,
      extends: 'Parent',
    })

    // The extends field documents the relationship
    expect(child.extends).toBe('Parent')

    // But actual schema inheritance is done via Zod
    const validChild = {
      $id: 'test',
      $type: 'https://schema.org.ai/Child',
      parentField: 'from parent',
      childField: 'child specific',
    }

    expect(child.schema.safeParse(validChild).success).toBe(true)
  })

  it('extends matches real-world usage patterns', () => {
    // Based on actual usage in nouns/workers/Agent.ts and nouns/business/Startup.ts
    const WorkerSchema = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Worker'),
      name: z.string(),
      status: z.enum(['available', 'busy', 'away', 'offline']),
    })

    const AgentSchema = WorkerSchema.omit({ $type: true }).extend({
      $type: z.literal('https://schema.org.ai/Agent'),
      model: z.string(),
      tools: z.array(z.string()),
    })

    const Worker = defineNoun({
      noun: 'Worker',
      plural: 'Workers',
      $type: 'https://schema.org.ai/Worker',
      schema: WorkerSchema,
    })

    const Agent = defineNoun({
      noun: 'Agent',
      plural: 'Agents',
      $type: 'https://schema.org.ai/Agent',
      schema: AgentSchema,
      extends: 'Worker',
    })

    expect(Agent.extends).toBe('Worker')

    // Validate Agent can parse data with both Worker and Agent fields
    const validAgent = {
      $id: 'agent-1',
      $type: 'https://schema.org.ai/Agent',
      name: 'Claude',
      status: 'available',
      model: 'claude-3-opus',
      tools: ['search', 'code'],
    }

    expect(Agent.schema.safeParse(validAgent).success).toBe(true)
  })
})

// ============================================================================
// Default values application
// ============================================================================

describe('Default values application', () => {
  it('stores defaults in noun definition', () => {
    const noun = defineNoun({
      noun: 'WithDefaults',
      plural: 'WithDefaults',
      $type: 'https://schema.org.ai/WithDefaults',
      schema: SimpleSchema,
      defaults: { name: 'Default Name' },
    })

    expect(noun.defaults).toBeDefined()
    expect(noun.defaults).toEqual({ name: 'Default Name' })
  })

  it('defaults field is optional', () => {
    const noun = defineNoun({
      noun: 'NoDefaults',
      plural: 'NoDefaults',
      $type: 'https://schema.org.ai/NoDefaults',
      schema: SimpleSchema,
    })

    expect(noun.defaults).toBeUndefined()
  })

  it('defaults are typed as Partial of schema inferred type', () => {
    const noun = defineNoun({
      noun: 'Typed',
      plural: 'Typeds',
      $type: 'https://schema.org.ai/Typed',
      schema: ComplexSchema,
      defaults: {
        name: 'Default',
        status: 'pending',
        // Note: We can't provide $id, $type, etc. as defaults since they're required
      },
    })

    expect(noun.defaults?.name).toBe('Default')
    expect(noun.defaults?.status).toBe('pending')
  })

  it('defaults can include nested objects', () => {
    const noun = defineNoun({
      noun: 'Nested',
      plural: 'Nesteds',
      $type: 'https://schema.org.ai/Complex',
      schema: ComplexSchema,
      defaults: {
        nested: { inner: 'default inner', value: 0 },
        tags: [],
      },
    })

    expect(noun.defaults?.nested).toEqual({ inner: 'default inner', value: 0 })
    expect(noun.defaults?.tags).toEqual([])
  })

  it('defaults can include arrays', () => {
    const SchemaWithArrays = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Arrays'),
      items: z.array(z.string()),
      numbers: z.array(z.number()),
    })

    const noun = defineNoun({
      noun: 'Arrays',
      plural: 'Arrays',
      $type: 'https://schema.org.ai/Arrays',
      schema: SchemaWithArrays,
      defaults: {
        items: ['default', 'items'],
        numbers: [1, 2, 3],
      },
    })

    expect(noun.defaults?.items).toEqual(['default', 'items'])
    expect(noun.defaults?.numbers).toEqual([1, 2, 3])
  })

  it('defaults match real-world patterns (Worker/Agent)', () => {
    // Based on nouns/workers/Worker.ts and nouns/workers/Agent.ts
    const WorkerSchema = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/Worker'),
      name: z.string(),
      skills: z.array(z.string()),
      status: z.enum(['available', 'busy', 'away', 'offline']),
    })

    const Worker = defineNoun({
      noun: 'Worker',
      plural: 'Workers',
      $type: 'https://schema.org.ai/Worker',
      schema: WorkerSchema,
      defaults: {
        status: 'available',
        skills: [],
      },
    })

    expect(Worker.defaults).toEqual({
      status: 'available',
      skills: [],
    })
  })

  it('defaults are for runtime use, not schema validation', () => {
    // Note: Zod defaults vs Noun defaults are different concepts
    // Noun defaults are for runtime application, not Zod parsing

    const SchemaWithZodDefault = z.object({
      $id: z.string(),
      $type: z.literal('https://schema.org.ai/ZodDefault'),
      name: z.string(),
      count: z.number().default(0), // Zod default
    })

    const noun = defineNoun({
      noun: 'ZodDefault',
      plural: 'ZodDefaults',
      $type: 'https://schema.org.ai/ZodDefault',
      schema: SchemaWithZodDefault,
      defaults: {
        name: 'Noun Default Name', // Noun-level default
      },
    })

    // Zod default is applied during parsing
    const parsed = noun.schema.parse({
      $id: 'test',
      $type: 'https://schema.org.ai/ZodDefault',
      name: 'Test',
      // count omitted - Zod will apply default
    })
    expect(parsed.count).toBe(0)

    // Noun defaults are stored but not automatically applied
    expect(noun.defaults?.name).toBe('Noun Default Name')
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge cases and error handling', () => {
  describe('empty and minimal nouns', () => {
    it('handles minimal schema', () => {
      const MinimalSchema = z.object({
        $id: z.string(),
      })

      const noun = defineNoun({
        noun: 'Minimal',
        plural: 'Minimals',
        $type: 'https://schema.org.ai/Minimal',
        schema: MinimalSchema,
      })

      expect(noun.schema.safeParse({ $id: 'test' }).success).toBe(true)
    })

    it('handles empty string values in schema', () => {
      const noun = defineNoun({
        noun: 'EmptyStrings',
        plural: 'EmptyStrings',
        $type: 'https://schema.org.ai/EmptyStrings',
        schema: SimpleSchema,
      })

      // Empty string should be valid for string fields (unless restricted)
      const result = noun.schema.safeParse({
        $id: '',
        $type: 'https://schema.org.ai/Simple',
        name: '',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('special characters in noun names', () => {
    it('accepts conventional PascalCase names', () => {
      const noun = defineNoun({
        noun: 'PaymentMethod',
        plural: 'PaymentMethods',
        $type: 'https://schema.org.ai/PaymentMethod',
        schema: SimpleSchema,
      })

      expect(noun.noun).toBe('PaymentMethod')
    })

    it('stores whatever name is provided (no validation)', () => {
      // Note: defineNoun does not validate noun names
      const noun = defineNoun({
        noun: 'weird-name with spaces!',
        plural: 'weird-names with spaces!',
        $type: 'https://schema.org.ai/Weird',
        schema: SimpleSchema,
      })

      expect(noun.noun).toBe('weird-name with spaces!')
    })
  })

  describe('schema validation edge cases', () => {
    it('handles union schemas', () => {
      const UnionSchema = z.union([
        z.object({ type: z.literal('a'), aField: z.string() }),
        z.object({ type: z.literal('b'), bField: z.number() }),
      ])

      const noun = defineNoun({
        noun: 'Union',
        plural: 'Unions',
        $type: 'https://schema.org.ai/Union',
        schema: UnionSchema,
      })

      expect(noun.schema.safeParse({ type: 'a', aField: 'test' }).success).toBe(true)
      expect(noun.schema.safeParse({ type: 'b', bField: 42 }).success).toBe(true)
      expect(noun.schema.safeParse({ type: 'c' }).success).toBe(false)
    })

    it('handles discriminated union schemas', () => {
      const DiscriminatedSchema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('circle'), radius: z.number() }),
        z.object({ kind: z.literal('square'), side: z.number() }),
      ])

      const noun = defineNoun({
        noun: 'Shape',
        plural: 'Shapes',
        $type: 'https://schema.org.ai/Shape',
        schema: DiscriminatedSchema,
      })

      expect(noun.schema.safeParse({ kind: 'circle', radius: 5 }).success).toBe(true)
      expect(noun.schema.safeParse({ kind: 'square', side: 10 }).success).toBe(true)
    })

    it('handles recursive schemas', () => {
      interface TreeNode {
        value: string
        children?: TreeNode[]
      }

      const TreeSchema: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({
          value: z.string(),
          children: z.array(TreeSchema).optional(),
        }),
      )

      const noun = defineNoun({
        noun: 'Tree',
        plural: 'Trees',
        $type: 'https://schema.org.ai/Tree',
        schema: TreeSchema,
      })

      const tree: TreeNode = {
        value: 'root',
        children: [
          { value: 'child1', children: [{ value: 'grandchild' }] },
          { value: 'child2' },
        ],
      }

      expect(noun.schema.safeParse(tree).success).toBe(true)
    })
  })

  describe('Collection edge cases', () => {
    it('Collection of Collection (nested)', () => {
      const SimpleNoun = defineNoun({
        noun: 'Simple',
        plural: 'Simples',
        $type: 'https://schema.org.ai/Simple',
        schema: SimpleSchema,
      })

      const collection = Collection(SimpleNoun)

      // Note: Collection() returns a Noun-like object, so we can nest
      // This tests if the implementation handles this edge case
      // The schema would be z.array(z.array(SimpleSchema))

      // Collection of a collection creates array of arrays
      expect(collection.schema).toBeDefined()
    })

    it('Collection preserves original noun immutably', () => {
      const noun = defineNoun({
        noun: 'Original',
        plural: 'Originals',
        $type: 'https://schema.org.ai/Original',
        schema: SimpleSchema,
      })

      const collection = Collection(noun)

      // Original noun should be unchanged
      expect(noun.noun).toBe('Original')
      expect(noun.plural).toBe('Originals')

      // Collection uses plural for its noun name
      expect(collection.noun).toBe('Originals')
    })
  })
})

// ============================================================================
// Type System Compatibility Tests
// ============================================================================

describe('Type system compatibility', () => {
  it('Noun interface is generic over ZodType', () => {
    // Test that Noun<T> properly constrains T to extend z.ZodType
    type StringNoun = Noun<z.ZodString>
    type ObjectNoun = Noun<z.ZodObject<{ name: z.ZodString }>>

    // These should compile
    const _test1: StringNoun = {
      noun: 'String',
      plural: 'Strings',
      $type: 'test',
      schema: z.string(),
    }

    const _test2: ObjectNoun = {
      noun: 'Object',
      plural: 'Objects',
      $type: 'test',
      schema: z.object({ name: z.string() }),
    }

    expect(_test1.schema._def.typeName).toBe('ZodString')
    expect(_test2.schema._def.typeName).toBe('ZodObject')
  })

  it('defaults type is Partial of inferred schema type', () => {
    // This tests that defaults are properly typed
    const noun = defineNoun({
      noun: 'Test',
      plural: 'Tests',
      $type: 'https://schema.org.ai/Test',
      schema: z.object({
        $id: z.string(),
        name: z.string(),
        count: z.number(),
        active: z.boolean(),
      }),
      defaults: {
        // Only some fields - this is Partial<{ $id: string, name: string, count: number, active: boolean }>
        count: 0,
        active: false,
      },
    })

    // Type check: defaults should have correct types
    expectTypeOf(noun.defaults?.count).toEqualTypeOf<number | undefined>()
    expectTypeOf(noun.defaults?.active).toEqualTypeOf<boolean | undefined>()
  })

  it('Collection return type includes itemType', () => {
    const noun = defineNoun({
      noun: 'Item',
      plural: 'Items',
      $type: 'https://schema.org.ai/Item',
      schema: SimpleSchema,
    })

    const collection = Collection(noun)

    // Collection should have itemType that matches the input noun type
    expectTypeOf(collection.itemType).toEqualTypeOf<typeof noun>()
  })
})

// ============================================================================
// Potential Type Issues (RED tests that may expose bugs)
// ============================================================================

describe('Potential type issues to investigate', () => {
  it('Collection $type should be schema.org/Collection not schema.org.ai/Collection', () => {
    // The types.ts uses 'https://schema.org.ai/Collection' but
    // standard JSON-LD would use 'https://schema.org/Collection'
    const noun = defineNoun({
      noun: 'Test',
      plural: 'Tests',
      $type: 'https://schema.org.ai/Test',
      schema: SimpleSchema,
    })

    const collection = Collection(noun)

    // This test documents the current behavior
    // Consider whether this should be schema.org or schema.org.ai
    expect(collection.$type).toBe('https://schema.org.ai/Collection')
  })

  it('Noun interface allows inconsistent noun/plural/schema.$type', () => {
    // defineNoun does not validate consistency between:
    // - noun name
    // - plural name
    // - $type URL
    // - schema.$type literal

    const inconsistent = defineNoun({
      noun: 'Foo', // Says Foo
      plural: 'Bars', // Says Bars (should be Foos)
      $type: 'https://schema.org.ai/Baz', // Says Baz
      schema: z.object({
        $id: z.string(),
        $type: z.literal('https://schema.org.ai/Qux'), // Says Qux!
      }),
    })

    // This compiles and runs - no runtime validation
    expect(inconsistent.noun).toBe('Foo')
    expect(inconsistent.plural).toBe('Bars')
    expect(inconsistent.$type).toBe('https://schema.org.ai/Baz')

    // The schema says Qux but noun.$type says Baz
    // This inconsistency could cause bugs
    const result = inconsistent.schema.safeParse({
      $id: 'test',
      $type: 'https://schema.org.ai/Qux', // Must match schema, not noun.$type
    })
    expect(result.success).toBe(true)
  })

  it('okrs field accepts any strings without validation', () => {
    const noun = defineNoun({
      noun: 'Test',
      plural: 'Tests',
      $type: 'https://schema.org.ai/Test',
      schema: SimpleSchema,
      okrs: ['InvalidOKR!!!', 'not-valid', '123'], // No validation
    })

    // okrs accepts any strings
    expect(noun.okrs).toEqual(['InvalidOKR!!!', 'not-valid', '123'])
  })

  it('extends field accepts any string without validation', () => {
    const noun = defineNoun({
      noun: 'Child',
      plural: 'Children',
      $type: 'https://schema.org.ai/Child',
      schema: SimpleSchema,
      extends: 'NonExistentParent', // No validation that this noun exists
    })

    // extends is just a string - no validation
    expect(noun.extends).toBe('NonExistentParent')
  })
})
