/**
 * Type Narrowing Tests for $.Entity Accessors (do-b1tuz)
 *
 * These tests verify that $.Entity(id) accessors have proper TypeScript
 * type narrowing when used with a typed entity schema.
 *
 * TDD RED phase: These tests demonstrate current type issues
 *
 * @module do/tests/entity-type-narrowing.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createContext } from '../workflow/context'
import { createThingsStore, type Thing, type StorableData } from '../../db'
import type {
  TypedEntityProxy,
  TypedEntityAccessor,
  TypedEntityInstance,
  EntitySchemaDefinition,
  DefineEntities,
  TypedWorkflowContextWithEntities,
} from '../workflow/entity'
import type {
  InferEntity,
  InferSchema,
  TypedDB,
  CreateInput,
  UpdateInput,
  InferFieldType,
  InferRelationType,
  TypedEntityAccessor as SchemaTypedEntityAccessor,
  TypedEntityInstance as SchemaTypedEntityInstance,
  TypedEntityProxy as SchemaTypedEntityProxy,
} from '../schema/infer'
import type { WorkflowContext } from '../workflow/types'

// =============================================================================
// ENTITY SCHEMA DEFINITIONS FOR TESTING
// =============================================================================

/**
 * Product entity schema - represents a product in the system
 */
interface ProductData {
  name: string
  price: number
  sku: string
  description?: string
  inStock: boolean
}

/**
 * Customer entity schema - represents a customer
 */
interface CustomerData {
  email: string
  name: string
  tier: 'free' | 'pro' | 'enterprise'
  createdAt?: number
}

/**
 * Order entity schema - represents an order
 */
interface OrderData {
  customerId: string
  items: Array<{ productId: string; quantity: number }>
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'delivered'
}

/**
 * Entity definitions map for typed context
 */
interface EntityDefinitions {
  Product: ProductData
  Customer: CustomerData
  Order: OrderData
}

// =============================================================================
// TYPE HELPER TESTS (Compile-time)
// =============================================================================

describe('Entity Type Narrowing (do-b1tuz)', () => {
  describe('TypedEntityProxy type definitions', () => {
    it('TypedEntityAccessor should preserve entity data type', () => {
      // This is a compile-time type test
      // If this file compiles, the TypedEntityAccessor type is correct

      // TypedEntityAccessor<ProductData> should have:
      // - define(schema): void
      // - create(data: ProductData): Promise<Thing<ProductData>>
      // - list(opts?): Promise<Thing<ProductData>[]>

      type ProductAccessor = TypedEntityAccessor<ProductData>

      // Verify create() accepts ProductData and returns Thing<ProductData>
      type CreateParam = Parameters<ProductAccessor['create']>[0]
      type CreateReturn = Awaited<ReturnType<ProductAccessor['create']>>

      // These assignments should compile without error
      const _createParam: CreateParam = {
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // The returned Thing should have typed data properties
      const _thing: CreateReturn = {
        $id: 'prod-123',
        $type: 'Product',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // Verify the Thing has the correct property types
      const _name: string = _thing.name
      const _price: number = _thing.price
      const _sku: string = _thing.sku
      const _inStock: boolean = _thing.inStock

      expect(_createParam.name).toBe('Widget')
      expect(_thing.name).toBe('Widget')
    })

    it('TypedEntityInstance should preserve entity data type', () => {
      // TypedEntityInstance<ProductData> should have:
      // - get(): Promise<Thing<ProductData> | null>
      // - update(data: Partial<ProductData>): Promise<Thing<ProductData>>
      // - delete(): Promise<void>

      type ProductInstance = TypedEntityInstance<ProductData>

      // Verify get() returns Thing<ProductData> | null
      type GetReturn = Awaited<ReturnType<ProductInstance['get']>>

      // The returned Thing (when not null) should have typed data properties
      const _thing: NonNullable<GetReturn> = {
        $id: 'prod-123',
        $type: 'Product',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // Verify update() accepts Partial<ProductData>
      type UpdateParam = Parameters<ProductInstance['update']>[0]
      const _updateParam: UpdateParam = { price: 14.99 }

      expect(_thing.price).toBe(9.99)
      expect(_updateParam.price).toBe(14.99)
    })

    it('TypedEntityProxy should be callable and have accessor methods', () => {
      // TypedEntityProxy<ProductData> should be:
      // - Callable as a function: (id: string) => TypedEntityInstance<ProductData>
      // - Have accessor methods: define, create, list

      type ProductProxy = TypedEntityProxy<ProductData>

      // This type should satisfy both:
      // 1. Function call signature: (id: string) => TypedEntityInstance<ProductData>
      // 2. Method properties: define, create, list

      // Verify the function call returns TypedEntityInstance<ProductData>
      type CallReturn = ReturnType<ProductProxy>
      type InstanceGetReturn = Awaited<ReturnType<CallReturn['get']>>

      // The instance's get() should return Thing<ProductData>
      const _instance: NonNullable<InstanceGetReturn> = {
        $id: 'prod-123',
        $type: 'Product',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      expect(_instance.name).toBe('Widget')
    })
  })

  describe('DefineEntities type helper', () => {
    it('should create entity definitions map from schema types', () => {
      // DefineEntities should transform:
      // { Product: ProductData, Customer: CustomerData }
      // Into a properly typed entity definitions map

      type MyEntities = DefineEntities<{
        Product: ProductData
        Customer: CustomerData
      }>

      // Verify the Product type is preserved
      type ProductType = MyEntities['Product']
      const _product: ProductType = {
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // Verify the Customer type is preserved
      type CustomerType = MyEntities['Customer']
      const _customer: CustomerType = {
        email: 'alice@example.com',
        name: 'Alice',
        tier: 'pro',
      }

      expect(_product.name).toBe('Widget')
      expect(_customer.email).toBe('alice@example.com')
    })
  })

  describe('TypedWorkflowContextWithEntities', () => {
    it('should provide typed entity accessors via $.Entity syntax', () => {
      // TypedWorkflowContextWithEntities<EntityDefinitions> should provide:
      // $.Product - TypedEntityProxy<ProductData>
      // $.Customer - TypedEntityProxy<CustomerData>
      // $.Order - TypedEntityProxy<OrderData>

      // This is a compile-time type test
      // The actual implementation test is below

      type $ = TypedWorkflowContextWithEntities<EntityDefinitions>

      // Verify $.Product is TypedEntityProxy<ProductData>
      type ProductProxy = $['Product']

      // Verify $.Product.create accepts ProductData
      // (This would be a type error if not properly typed)
      type ProductCreateParam = Parameters<ProductProxy['create']>[0]

      const _productData: ProductCreateParam = {
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // Verify $.Customer is TypedEntityProxy<CustomerData>
      type CustomerProxy = $['Customer']
      type CustomerCreateParam = Parameters<CustomerProxy['create']>[0]

      const _customerData: CustomerCreateParam = {
        email: 'alice@example.com',
        name: 'Alice',
        tier: 'enterprise',
      }

      expect(_productData.name).toBe('Widget')
      expect(_customerData.tier).toBe('enterprise')
    })

    it('should narrow $.Entity(id) return type correctly', () => {
      // When calling $.Product(id), the returned instance should be
      // TypedEntityInstance<ProductData>, not EntityInstance<StorableData>

      type $ = TypedWorkflowContextWithEntities<EntityDefinitions>

      // Simulate calling $.Product('prod-123')
      type ProductInstance = ReturnType<$['Product']>

      // The get() method should return Thing<ProductData> | null
      type GetReturn = Awaited<ReturnType<ProductInstance['get']>>

      // Verify the return type has the correct shape
      // (If types are wrong, this would be a type error)
      const _product: NonNullable<GetReturn> = {
        $id: 'prod-123',
        $type: 'Product',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // Accessing typed properties should work without type assertions
      const _name: string = _product.name
      const _price: number = _product.price

      expect(_name).toBe('Widget')
      expect(_price).toBe(9.99)
    })

    it('should reject incorrect data types at compile time', () => {
      // This test verifies that type errors occur when passing wrong types

      type $ = TypedWorkflowContextWithEntities<EntityDefinitions>
      type ProductProxy = $['Product']
      type ProductCreateParam = Parameters<ProductProxy['create']>[0]

      // These should be valid
      const _validProduct: ProductCreateParam = {
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      }

      // The following would be type errors (commented out to prevent compilation failure):
      // @ts-expect-error - missing required field 'sku'
      const _missingField: ProductCreateParam = {
        name: 'Widget',
        price: 9.99,
        inStock: true,
      }

      // @ts-expect-error - wrong type for 'price' (string instead of number)
      const _wrongType: ProductCreateParam = {
        name: 'Widget',
        price: '9.99', // Should be number
        sku: 'WDG-001',
        inStock: true,
      }

      expect(_validProduct.name).toBe('Widget')
    })
  })

  // =============================================================================
  // RUNTIME TESTS
  // =============================================================================

  describe('Runtime type narrowing with createTypedEntityContext', () => {
    it('should create context with typed entity accessors', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState

      // Create context with typed entities (when implemented)
      const $ = createContext(mockState, {}, { things })

      // Create a product
      const product = await $.Product.create({
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      })

      expect(product.$type).toBe('Product')
      expect(product.name).toBe('Widget')
      expect(product.price).toBe(9.99)
    })

    it('should return typed instance from $.Entity(id)', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Create a product
      const created = await $.Product.create({
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      })

      // Get via $.Product(id)
      const retrieved = await $.Product(created.$id).get()

      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.name).toBe('Widget')

      // Type narrowing test: TypeScript should know these are the correct types
      // (This is verified at compile time, but we test runtime values too)
      if (retrieved) {
        const name: string = retrieved.name
        const price: number = retrieved.price
        expect(name).toBe('Widget')
        expect(price).toBe(9.99)
      }
    })

    it('should preserve type through update operations', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const created = await $.Product.create({
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
      })

      // Update should accept Partial<ProductData> and return Thing<ProductData>
      const updated = await $.Product(created.$id).update({
        price: 14.99,
        inStock: false,
      })

      expect(updated.price).toBe(14.99)
      expect(updated.inStock).toBe(false)
      expect(updated.name).toBe('Widget') // Unchanged fields preserved
    })

    it('should preserve type through list operations', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      await $.Product.create({ name: 'Widget', price: 9.99, sku: 'WDG-001', inStock: true })
      await $.Product.create({ name: 'Gadget', price: 19.99, sku: 'GDG-001', inStock: true })

      // list() should return Thing<ProductData>[]
      const products = await $.Product.list()

      expect(products.length).toBe(2)

      // Type narrowing: each product should have typed properties
      for (const product of products) {
        expect(typeof product.name).toBe('string')
        expect(typeof product.price).toBe('number')
        expect(typeof product.sku).toBe('string')
        expect(typeof product.inStock).toBe('boolean')
      }
    })
  })

  describe('Type narrowing edge cases', () => {
    it('should handle optional fields correctly', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Create product without optional 'description' field
      const product = await $.Product.create({
        name: 'Widget',
        price: 9.99,
        sku: 'WDG-001',
        inStock: true,
        // description is optional, so this should be valid
      })

      expect(product.description).toBeUndefined()

      // Update with optional field
      const updated = await $.Product(product.$id).update({
        description: 'A great widget',
      })

      expect(updated.description).toBe('A great widget')
    })

    it('should handle union types in entity fields', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Customer.tier is a union type: 'free' | 'pro' | 'enterprise'
      const customer = await $.Customer.create({
        email: 'alice@example.com',
        name: 'Alice',
        tier: 'pro',
      })

      expect(customer.tier).toBe('pro')

      // Update with valid union value
      const updated = await $.Customer(customer.$id).update({
        tier: 'enterprise',
      })

      expect(updated.tier).toBe('enterprise')
    })

    it('should handle nested object types in entity fields', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Order.items is an array of objects
      const order = await $.Order.create({
        customerId: 'cust-123',
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 },
        ],
        total: 49.97,
        status: 'pending',
      })

      expect(order.items.length).toBe(2)
      expect(order.items[0].productId).toBe('prod-1')
      expect(order.items[0].quantity).toBe(2)
    })
  })

  // =============================================================================
  // SCHEMA-BASED TYPE INFERENCE TESTS (do-b1tuz GREEN phase)
  // =============================================================================

  describe('Schema-based type inference (TypedDB)', () => {
    /**
     * Define a schema using `as const` for literal type inference.
     * This is the recommended pattern for type-safe entity definitions.
     */
    const productSchema = {
      Product: {
        sku: 'string!#',
        name: 'string!',
        price: 'decimal(10,2)!',
        description: 'string?',
        inStock: 'boolean!',
        tags: 'string[]',
      },
      Vendor: {
        name: 'string!',
        email: 'string!#',
        active: 'boolean!',
      },
    } as const

    it('InferEntity should correctly infer entity types from schema', () => {
      // InferEntity<typeof productSchema, 'Product'> should infer:
      // {
      //   $id: string
      //   $type: 'Product'
      //   sku: string       (required)
      //   name: string      (required)
      //   price: number     (required, decimal -> number)
      //   description?: string (optional)
      //   inStock: boolean  (required)
      //   tags?: string[]   (optional array)
      // }

      type Product = InferEntity<typeof productSchema, 'Product'>

      // Verify the inferred type has correct structure
      const _product: Product = {
        $id: 'prod-123',
        $type: 'Product',
        sku: 'SKU-001',
        name: 'Widget',
        price: 9.99,
        inStock: true,
        // description and tags are optional
      }

      // Type narrowing: verify property types
      const _sku: string = _product.sku
      const _name: string = _product.name
      const _price: number = _product.price
      const _inStock: boolean = _product.inStock

      expect(_product.$id).toBe('prod-123')
      expect(_product.$type).toBe('Product')
      expect(_sku).toBe('SKU-001')
      expect(_price).toBe(9.99)
    })

    it('InferSchema should infer all entity types', () => {
      // InferSchema<typeof productSchema> should produce:
      // {
      //   Product: { $id, $type, sku, name, price, ... }
      //   Vendor: { $id, $type, name, email, active }
      // }

      type Schema = InferSchema<typeof productSchema>
      type Product = Schema['Product']
      type Vendor = Schema['Vendor']

      const _product: Product = {
        $id: 'prod-1',
        $type: 'Product',
        sku: 'SKU',
        name: 'Widget',
        price: 10,
        inStock: true,
      }

      const _vendor: Vendor = {
        $id: 'vendor-1',
        $type: 'Vendor',
        name: 'Acme Corp',
        email: 'contact@acme.com',
        active: true,
      }

      expect(_product.$type).toBe('Product')
      expect(_vendor.$type).toBe('Vendor')
    })

    it('TypedDB should create typed entity accessors from schema', () => {
      // TypedDB<typeof productSchema> should produce:
      // {
      //   Product: TypedEntityProxy<InferEntity<Schema, 'Product'>>
      //   Vendor: TypedEntityProxy<InferEntity<Schema, 'Vendor'>>
      // }

      type DB = TypedDB<typeof productSchema>

      // Verify Product accessor type
      type ProductProxy = DB['Product']
      type ProductCreateParam = Parameters<ProductProxy['create']>[0]

      // CreateInput<Product> omits $id, $type, timestamps
      const _createData: ProductCreateParam = {
        sku: 'SKU-001',
        name: 'Widget',
        price: 9.99,
        inStock: true,
      }

      expect(_createData.sku).toBe('SKU-001')
    })

    it('CreateInput should omit system fields from entity type', () => {
      type Product = InferEntity<typeof productSchema, 'Product'>
      type ProductCreate = CreateInput<Product>

      // ProductCreate should NOT have $id, $type, $createdAt, $updatedAt
      // It should have all the data fields

      const _create: ProductCreate = {
        sku: 'SKU',
        name: 'Name',
        price: 10,
        inStock: true,
        // Optional fields can be omitted
      }

      // @ts-expect-error - $id should not be in CreateInput
      const _withId: ProductCreate = {
        $id: 'bad',
        sku: 'SKU',
        name: 'Name',
        price: 10,
        inStock: true,
      }

      expect(_create.sku).toBe('SKU')
    })

    it('UpdateInput should make all fields optional except system fields', () => {
      type Product = InferEntity<typeof productSchema, 'Product'>
      type ProductUpdate = UpdateInput<Product>

      // UpdateInput<Product> should have all fields optional
      const _update1: ProductUpdate = { price: 14.99 }
      const _update2: ProductUpdate = { inStock: false, name: 'New Name' }
      const _update3: ProductUpdate = {} // Empty update is valid

      expect(_update1.price).toBe(14.99)
      expect(_update2.inStock).toBe(false)
    })

    it('InferFieldType should correctly map field definition strings', () => {
      // Test various field type inferences
      type RequiredString = InferFieldType<'string!'>
      type OptionalString = InferFieldType<'string?'>
      type StringArray = InferFieldType<'string[]'>
      type DecimalType = InferFieldType<'decimal(10,2)!'>
      type BooleanType = InferFieldType<'boolean!'>
      type DateType = InferFieldType<'datetime!'>

      // These should all compile correctly
      const _reqStr: RequiredString = 'hello'
      const _optStr: OptionalString = undefined
      const _strArr: StringArray = ['a', 'b']
      const _decimal: DecimalType = 123.45
      const _bool: BooleanType = true
      const _date: DateType = new Date()

      expect(_reqStr).toBe('hello')
      expect(_optStr).toBeUndefined()
      expect(_strArr).toEqual(['a', 'b'])
    })

    it('Combined WorkflowContext & TypedDB should provide full type safety', () => {
      // This is the target usage pattern for $.Entity accessors
      type TypedContext = WorkflowContext & TypedDB<typeof productSchema>

      // Simulate the type of $ with typed entities
      type ProductAccessor = TypedContext['Product']

      // Verify create returns the correct type
      type CreateReturn = Awaited<ReturnType<ProductAccessor['create']>>

      const _created: CreateReturn = {
        $id: 'prod-1',
        $type: 'Product',
        sku: 'SKU',
        name: 'Widget',
        price: 10,
        inStock: true,
      }

      // Verify instance accessor returns correct type
      type InstanceGet = Awaited<ReturnType<ReturnType<ProductAccessor>['get']>>

      const _retrieved: NonNullable<InstanceGet> = {
        $id: 'prod-1',
        $type: 'Product',
        sku: 'SKU',
        name: 'Widget',
        price: 10,
        inStock: true,
      }

      expect(_created.$type).toBe('Product')
      expect(_retrieved.sku).toBe('SKU')
    })
  })

  describe('Relation type inference', () => {
    const schemaWithRelations = {
      Order: {
        orderNumber: 'string!#',
        total: 'decimal(10,2)!',
        customer: '-> Customer!',
        items: '<- OrderItem.order[]',
      },
      Customer: {
        email: 'string!#',
        name: 'string!',
        orders: '<- Order.customer[]',
      },
      OrderItem: {
        quantity: 'int!',
        price: 'decimal(10,2)!',
        order: '-> Order!',
        product: '-> Product?',
      },
      Product: {
        sku: 'string!#',
        name: 'string!',
      },
    } as const

    it('InferRelationType should resolve forward relations', () => {
      // Forward relation: -> Customer! should resolve to Customer type
      type CustomerRef = InferRelationType<typeof schemaWithRelations, '-> Customer!'>

      // This should be the Customer entity type
      const _customer: CustomerRef = {
        $id: 'cust-1',
        $type: 'Customer',
        email: 'test@example.com',
        name: 'Test User',
      }

      expect(_customer.email).toBe('test@example.com')
    })

    it('InferRelationType should handle optional relations', () => {
      // Optional relation: -> Product? should resolve to Product | undefined
      type ProductRef = InferRelationType<typeof schemaWithRelations, '-> Product?'>

      const _withProduct: ProductRef = {
        $id: 'prod-1',
        $type: 'Product',
        sku: 'SKU-001',
        name: 'Widget',
      }

      const _withoutProduct: ProductRef = undefined

      expect(_withProduct).toBeDefined()
      expect(_withoutProduct).toBeUndefined()
    })

    it('InferRelationType should handle array relations', () => {
      // Array relation: <- OrderItem.order[] should resolve to OrderItem[]
      type OrderItems = InferRelationType<typeof schemaWithRelations, '<- OrderItem.order[]'>

      const _items: OrderItems = [
        {
          $id: 'item-1',
          $type: 'OrderItem',
          quantity: 2,
          price: 9.99,
        },
        {
          $id: 'item-2',
          $type: 'OrderItem',
          quantity: 1,
          price: 19.99,
        },
      ]

      expect(_items.length).toBe(2)
      expect(_items[0].quantity).toBe(2)
    })

    it('InferEntity should include relation fields with correct types', () => {
      type Order = InferEntity<typeof schemaWithRelations, 'Order'>

      // Order should have:
      // - customer: Customer (required forward relation)
      // - items: OrderItem[] (backward array relation)

      const _order: Order = {
        $id: 'order-1',
        $type: 'Order',
        orderNumber: 'ORD-001',
        total: 99.99,
        customer: {
          $id: 'cust-1',
          $type: 'Customer',
          email: 'test@example.com',
          name: 'Test',
        },
        items: [
          {
            $id: 'item-1',
            $type: 'OrderItem',
            quantity: 1,
            price: 99.99,
          },
        ],
      }

      expect(_order.customer.email).toBe('test@example.com')
      expect(_order.items?.[0]?.quantity).toBe(1)
    })
  })
})
