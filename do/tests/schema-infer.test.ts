/**
 * Schema Type Inference Tests (do-lekf.7)
 *
 * Tests for TypeScript type inference from unified schema definitions.
 * Uses expectTypeOf for compile-time type checking.
 *
 * @module do/tests/schema-infer.test
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  InferEntity,
  InferSchema,
  CreateInput,
  UpdateInput,
  TypedEntityProxy,
  TypedDB,
  EntityNames,
  AnyEntity,
  RelationFields,
  DataFields,
} from '../schema/infer'
import type { RawDatabaseSchema } from '../schema/types'

// =============================================================================
// TEST SCHEMA DEFINITIONS
// =============================================================================

/**
 * Simple schema for basic type inference tests
 */
const simpleSchema = {
  Product: {
    sku: 'string!',
    name: 'string!',
    price: 'number!',
    active: 'boolean',
  },
} as const satisfies RawDatabaseSchema

/**
 * Schema with various field types
 */
const typesSchema = {
  TypeTest: {
    // String types
    stringField: 'string!',
    textField: 'text',
    uuidField: 'uuid',
    markdownField: 'markdown',
    urlField: 'url',
    // Number types
    intField: 'int!',
    longField: 'long',
    floatField: 'float',
    doubleField: 'double',
    decimalField: 'decimal(10,2)',
    numberField: 'number',
    // Boolean types
    boolField: 'bool',
    booleanField: 'boolean!',
    // Date types
    dateField: 'date',
    datetimeField: 'datetime',
    timestampField: 'timestamp',
    // JSON type
    jsonField: 'json',
    // Array types
    tagsField: 'string[]',
    numbersField: 'int[]',
  },
} as const satisfies RawDatabaseSchema

/**
 * Schema with relations
 */
const relationsSchema = {
  Product: {
    sku: 'string!#',
    name: 'string!',
    price: 'decimal(10,2)!',
    tags: 'string[]',
    vendor: '-> Vendor?',
    categories: '-> Category[]',
  },
  Vendor: {
    name: 'string!',
    email: 'string!#',
    products: '<- Product.vendor[]',
  },
  Category: {
    name: 'string!',
    slug: 'string!#',
    products: '<- Product.categories[]',
  },
} as const satisfies RawDatabaseSchema

/**
 * Schema with AI-generated prompt fields
 */
const promptSchema = {
  BlogPost: {
    title: 'string!',
    content: 'markdown!',
    description: 'A compelling SEO-optimized summary of the blog post',
    keywords: 'SEO keywords based on the content',
    author: '-> Author?',
    $instructions: 'Generate engaging content for a tech blog',
  },
  Author: {
    name: 'string!',
    bio: 'A professional bio for this author',
    posts: '<- BlogPost.author[]',
  },
} as const satisfies RawDatabaseSchema

// =============================================================================
// BASIC TYPE INFERENCE TESTS
// =============================================================================

describe('Schema Type Inference (do-lekf.7)', () => {
  describe('InferEntity - Basic Types', () => {
    it('should infer $id and $type fields', () => {
      type Product = InferEntity<typeof simpleSchema, 'Product'>

      // Check that $id is string
      expectTypeOf<Product['$id']>().toBeString()

      // Check that $type is the literal 'Product'
      expectTypeOf<Product['$type']>().toEqualTypeOf<'Product'>()
    })

    it('should infer required string fields', () => {
      type Product = InferEntity<typeof simpleSchema, 'Product'>

      // Required fields (!) should not be optional
      expectTypeOf<Product['sku']>().toBeString()
      expectTypeOf<Product['name']>().toBeString()
    })

    it('should infer required number fields', () => {
      type Product = InferEntity<typeof simpleSchema, 'Product'>

      expectTypeOf<Product['price']>().toBeNumber()
    })

    it('should infer optional boolean fields', () => {
      type Product = InferEntity<typeof simpleSchema, 'Product'>

      // Optional field (no modifier) should allow undefined
      type ActiveType = Product['active']
      expectTypeOf<boolean | undefined>().toMatchTypeOf<ActiveType>()
    })
  })

  describe('InferEntity - All Primitive Types', () => {
    type TypeTest = InferEntity<typeof typesSchema, 'TypeTest'>

    it('should infer string types correctly', () => {
      expectTypeOf<TypeTest['stringField']>().toBeString()
      // Optional fields
      type TextField = TypeTest['textField']
      type UuidField = TypeTest['uuidField']
      expectTypeOf<string | undefined>().toMatchTypeOf<TextField>()
      expectTypeOf<string | undefined>().toMatchTypeOf<UuidField>()
    })

    it('should infer number types correctly', () => {
      expectTypeOf<TypeTest['intField']>().toBeNumber()
      // Optional number fields
      type LongField = TypeTest['longField']
      type FloatField = TypeTest['floatField']
      expectTypeOf<number | undefined>().toMatchTypeOf<LongField>()
      expectTypeOf<number | undefined>().toMatchTypeOf<FloatField>()
    })

    it('should infer boolean types correctly', () => {
      expectTypeOf<TypeTest['booleanField']>().toBeBoolean()
      // Optional bool field
      type BoolField = TypeTest['boolField']
      expectTypeOf<boolean | undefined>().toMatchTypeOf<BoolField>()
    })

    it('should infer date types correctly', () => {
      type DateField = TypeTest['dateField']
      type DatetimeField = TypeTest['datetimeField']
      // Date fields are optional by default
      expectTypeOf<Date | undefined>().toMatchTypeOf<DateField>()
      expectTypeOf<Date | undefined>().toMatchTypeOf<DatetimeField>()
    })

    it('should infer json type as Record', () => {
      type JsonField = TypeTest['jsonField']
      expectTypeOf<Record<string, unknown> | undefined>().toMatchTypeOf<JsonField>()
    })

    it('should infer array types correctly', () => {
      type TagsField = TypeTest['tagsField']
      type NumbersField = TypeTest['numbersField']
      // Array fields are optional
      expectTypeOf<string[] | undefined>().toMatchTypeOf<TagsField>()
      expectTypeOf<number[] | undefined>().toMatchTypeOf<NumbersField>()
    })
  })

  describe('InferEntity - Relations', () => {
    type Product = InferEntity<typeof relationsSchema, 'Product'>
    type Vendor = InferEntity<typeof relationsSchema, 'Vendor'>
    type Category = InferEntity<typeof relationsSchema, 'Category'>

    it('should infer optional single relation', () => {
      // vendor: '-> Vendor?' is optional single relation
      type VendorField = Product['vendor']
      // Should allow Vendor or undefined
      expectTypeOf<VendorField>().toMatchTypeOf<Vendor | undefined>()
    })

    it('should infer array relation', () => {
      // categories: '-> Category[]' is array relation
      type CategoriesField = Product['categories']
      // Should be Category[] or undefined (arrays optional by default)
      expectTypeOf<Category[] | undefined>().toMatchTypeOf<CategoriesField>()
    })

    it('should infer backward relation', () => {
      // products: '<- Product.vendor[]' is backward array relation
      type ProductsField = Vendor['products']
      // Should be Product[] or undefined
      expectTypeOf<Product[] | undefined>().toMatchTypeOf<ProductsField>()
    })
  })

  describe('InferEntity - Prompt Fields', () => {
    type BlogPost = InferEntity<typeof promptSchema, 'BlogPost'>
    type Author = InferEntity<typeof promptSchema, 'Author'>

    it('should infer prompt fields as optional strings', () => {
      // Prompt fields like 'A compelling SEO-optimized summary...' are optional strings
      type DescriptionField = BlogPost['description']
      type KeywordsField = BlogPost['keywords']

      expectTypeOf<string | undefined>().toMatchTypeOf<DescriptionField>()
      expectTypeOf<string | undefined>().toMatchTypeOf<KeywordsField>()
    })

    it('should infer regular fields alongside prompts', () => {
      // Regular required field
      expectTypeOf<BlogPost['title']>().toBeString()
      expectTypeOf<BlogPost['content']>().toBeString()
    })
  })

  describe('InferSchema', () => {
    it('should infer all entities in schema', () => {
      type Entities = InferSchema<typeof relationsSchema>

      // Should have all entity types
      expectTypeOf<Entities['Product']>().toMatchTypeOf<{
        $id: string
        $type: 'Product'
      }>()
      expectTypeOf<Entities['Vendor']>().toMatchTypeOf<{
        $id: string
        $type: 'Vendor'
      }>()
      expectTypeOf<Entities['Category']>().toMatchTypeOf<{
        $id: string
        $type: 'Category'
      }>()
    })
  })

  describe('CreateInput and UpdateInput', () => {
    type Product = InferEntity<typeof simpleSchema, 'Product'>

    it('should omit $id and $type from CreateInput', () => {
      type Input = CreateInput<Product>

      // Should not have $id or $type
      expectTypeOf<Input>().not.toHaveProperty('$id')
      expectTypeOf<Input>().not.toHaveProperty('$type')

      // Should have data fields
      expectTypeOf<Input>().toHaveProperty('sku')
      expectTypeOf<Input>().toHaveProperty('name')
    })

    it('should make all fields optional in UpdateInput', () => {
      type Input = UpdateInput<Product>

      // All fields should be optional
      type SkuField = Input['sku']
      type NameField = Input['name']
      expectTypeOf<string | undefined>().toMatchTypeOf<SkuField>()
      expectTypeOf<string | undefined>().toMatchTypeOf<NameField>()
    })
  })

  describe('EntityNames utility', () => {
    it('should extract entity names as union', () => {
      type Names = EntityNames<typeof relationsSchema>

      expectTypeOf<Names>().toEqualTypeOf<'Product' | 'Vendor' | 'Category'>()
    })
  })

  describe('AnyEntity utility', () => {
    it('should create union of all entity types', () => {
      type Any = AnyEntity<typeof relationsSchema>

      // Should be union of Product | Vendor | Category
      // Each with their $type
      expectTypeOf<Any>().toMatchTypeOf<{ $id: string; $type: string }>()
    })
  })

  describe('RelationFields utility', () => {
    it('should extract relation field names', () => {
      type ProductRelations = RelationFields<typeof relationsSchema, 'Product'>

      // Product has vendor and categories relations
      expectTypeOf<ProductRelations>().toEqualTypeOf<'vendor' | 'categories'>()
    })

    it('should return never for entities without relations', () => {
      const noRelationsSchema = {
        Simple: {
          name: 'string!',
          value: 'number',
        },
      } as const satisfies RawDatabaseSchema

      type SimpleRelations = RelationFields<typeof noRelationsSchema, 'Simple'>
      expectTypeOf<SimpleRelations>().toBeNever()
    })
  })

  describe('DataFields utility', () => {
    it('should extract non-relation field names', () => {
      type ProductDataFields = DataFields<typeof relationsSchema, 'Product'>

      // Product has sku, name, price, tags as data fields (not vendor, categories)
      expectTypeOf<ProductDataFields>().toEqualTypeOf<'sku' | 'name' | 'price' | 'tags'>()
    })
  })
})

// =============================================================================
// RUNTIME TYPE ASSERTION TESTS
// =============================================================================

describe('Schema Type Inference - Runtime Assertions', () => {
  it('should create valid typed object matching InferEntity', () => {
    type Product = InferEntity<typeof simpleSchema, 'Product'>

    // This should type-check if InferEntity is correct
    const product: Product = {
      $id: 'prod-123',
      $type: 'Product',
      sku: 'SKU-001',
      name: 'Widget',
      price: 9.99,
      active: true,
    }

    expect(product.$id).toBe('prod-123')
    expect(product.$type).toBe('Product')
    expect(product.sku).toBe('SKU-001')
  })

  it('should allow omitting optional fields', () => {
    type Product = InferEntity<typeof simpleSchema, 'Product'>

    // active is optional, so we can omit it
    const product: Product = {
      $id: 'prod-123',
      $type: 'Product',
      sku: 'SKU-001',
      name: 'Widget',
      price: 9.99,
      // active is omitted
    }

    expect(product.$id).toBe('prod-123')
    expect(product.active).toBeUndefined()
  })

  it('should create valid CreateInput', () => {
    type Product = InferEntity<typeof simpleSchema, 'Product'>
    type Input = CreateInput<Product>

    // CreateInput should not require $id or $type
    const input: Input = {
      sku: 'SKU-001',
      name: 'Widget',
      price: 9.99,
    }

    expect(input.sku).toBe('SKU-001')
  })

  it('should create valid UpdateInput with partial fields', () => {
    type Product = InferEntity<typeof simpleSchema, 'Product'>
    type Input = UpdateInput<Product>

    // UpdateInput makes all fields optional
    const input: Input = {
      price: 14.99,
    }

    expect(input.price).toBe(14.99)
    expect(input.sku).toBeUndefined()
  })
})
