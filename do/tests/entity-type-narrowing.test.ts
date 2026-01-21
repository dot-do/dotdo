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
})
