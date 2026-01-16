/**
 * DO Test Utilities - Shared helpers for testing Durable Objects
 *
 * Provides:
 * - createTestDO() - Get DO stub with unique or named instance
 * - createTestCustomer() - Create test customer data
 * - createTestOrder() - Create test order data
 * - Properly typed interfaces (DOCoreTestInstance)
 * - Common fixtures and test data
 *
 * @module tests/helpers/do-test-utils
 */

import { env } from 'cloudflare:test'
import type { ThingData } from '../../types'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * DOCoreTestInstance - Type-safe interface for DOCore stub in tests
 *
 * This interface exposes the RPC methods available on DOCore for testing.
 * Using this type avoids `as any` casts throughout test files.
 */
export interface DOCoreTestInstance {
  // State management (via RPC)
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<boolean>
  delete(key: string): Promise<void>
  setMany(entries: Record<string, unknown>): Promise<void>
  deleteMany(keys: string[]): Promise<void>
  list(options?: ListOptions): Promise<Record<string, unknown>>

  // Alarm scheduling
  setAlarm(time: Date | number): Promise<void>
  getAlarm(): Promise<Date | null>
  deleteAlarm(): Promise<void>

  // RPC methods
  ping(): Promise<string>
  add(a: number, b: number): Promise<number>
  asyncOperation(input: string): Promise<{ status: string; input: string }>
  throwError(): Promise<never>

  // Lifecycle methods
  prepareHibernate(): Promise<void>
  wake(): Promise<void>

  // Transaction support
  transaction(ops: TransactionOp[]): Promise<TransactionResult>
  query(sql: string, params: unknown[]): Promise<unknown[]>

  // WebSocket support
  getWebSocketTags(): Promise<string[]>
  broadcast(tag: string, message: unknown): Promise<{ sent: number }>
  isWebSocketHibernatable(): Promise<boolean>

  // Noun accessors - returns NounAccessor or NounInstanceAccessor
  noun(nounType: string, id?: string): NounAccessorRPC
  Customer(id?: string): NounAccessorRPC
  Order(id?: string): NounAccessorRPC
  Product(id?: string): NounAccessorRPC
  Payment(id?: string): NounAccessorRPC
  Invoice(id?: string): NounAccessorRPC
  User(id?: string): NounAccessorRPC
  Item(id?: string): NounAccessorRPC
  Temp(id?: string): NounAccessorRPC

  // Direct thing operations
  create(noun: string, data: Record<string, unknown>): Promise<ThingData>
  listThings(noun: string, query?: ThingQuery): Promise<ThingData[]>

  // State accessor (for StateManager tests)
  state: StateAccessorRPC

  // Fetch for HTTP testing
  fetch(url: string, init?: RequestInit): Promise<Response>
}

/**
 * NounAccessorRPC - Type-safe interface for noun accessor RPC calls
 *
 * Supports both collection-level (no id) and instance-level (with id) operations.
 */
export interface NounAccessorRPC {
  // Collection-level operations (when no id provided)
  create(data: Record<string, unknown>): Promise<ThingData>
  list(query?: ThingQuery): Promise<ThingData[]>

  // Instance-level operations (when id provided)
  get(): Promise<ThingData | null>
  update(updates: Record<string, unknown>): Promise<ThingData>
  delete(): Promise<void>
  exists(): Promise<boolean>
}

/**
 * StateAccessorRPC - Type-safe interface for state management RPC
 */
export interface StateAccessorRPC {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<boolean>
  delete(key: string): Promise<void>
  list(options?: ListOptions): Promise<Record<string, unknown>>
}

/**
 * ListOptions - Options for listing state entries
 */
export interface ListOptions {
  prefix?: string
  start?: string
  end?: string
  limit?: number
  reverse?: boolean
}

/**
 * TransactionOp - Operation for transactional updates
 */
export interface TransactionOp {
  op: 'set' | 'delete' | 'error'
  key?: string
  value?: unknown
}

/**
 * TransactionResult - Result of a transaction
 */
export interface TransactionResult {
  success: boolean
  error?: string
}

/**
 * ThingQuery - Query options for listing things
 */
export interface ThingQuery {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
}

// ============================================================================
// Test Helper Functions
// ============================================================================

/**
 * Create a test DO instance with a unique or specified name
 *
 * @param binding - The DO binding from env (defaults to env.DOCore)
 * @param name - Optional name for the DO instance. If not provided, generates a unique name.
 * @returns The DO stub typed as DOCoreTestInstance
 *
 * @example
 * ```typescript
 * // With auto-generated unique name
 * const doInstance = createTestDO()
 *
 * // With specific binding
 * const doInstance = createTestDO(env.DOCore)
 *
 * // With specific name
 * const doInstance = createTestDO(env.DOCore, 'my-test-instance')
 * ```
 */
export function createTestDO(
  binding?: DurableObjectNamespace,
  name?: string
): DOCoreTestInstance {
  const doBinding = binding ?? env.DOCore
  const instanceName = name ?? generateTestName()
  const id = doBinding.idFromName(instanceName)
  return doBinding.get(id) as unknown as DOCoreTestInstance
}

/**
 * Generate a unique test name using timestamp and random suffix
 */
function generateTestName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Default test customer data
 */
export interface TestCustomerData {
  name: string
  email: string
  phone?: string
  address?: {
    street: string
    city: string
    state: string
    zip: string
  }
  tags?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Default test order data
 */
export interface TestOrderData {
  customerId: string
  items: Array<{
    productId: string
    quantity: number
    price: number
  }>
  total: number
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
  shippingAddress?: {
    street: string
    city: string
    state: string
    zip: string
  }
  metadata?: Record<string, unknown>
}

/**
 * Default test product data
 */
export interface TestProductData {
  name: string
  description?: string
  price: number
  sku: string
  category?: string
  inventory?: number
  tags?: string[]
}

/**
 * Create a test customer with optional overrides
 *
 * @param stub - The DO stub to create the customer on
 * @param overrides - Optional data to override defaults
 * @returns The created customer ThingData
 *
 * @example
 * ```typescript
 * const customer = await createTestCustomer(doInstance)
 * const vipCustomer = await createTestCustomer(doInstance, { tags: ['vip'] })
 * ```
 */
export async function createTestCustomer(
  stub: DOCoreTestInstance,
  overrides?: Partial<TestCustomerData>
): Promise<ThingData> {
  const defaults: TestCustomerData = {
    name: 'Test Customer',
    email: `test-${Date.now()}@example.com`,
    phone: '+1-555-0100',
    tags: ['test'],
  }

  const data = { ...defaults, ...overrides }
  return stub.noun('Customer').create(data)
}

/**
 * Create a test order with optional overrides
 *
 * @param stub - The DO stub to create the order on
 * @param overrides - Optional data to override defaults
 * @returns The created order ThingData
 *
 * @example
 * ```typescript
 * const order = await createTestOrder(doInstance)
 * const bigOrder = await createTestOrder(doInstance, { total: 1000 })
 * ```
 */
export async function createTestOrder(
  stub: DOCoreTestInstance,
  overrides?: Partial<TestOrderData>
): Promise<ThingData> {
  const defaults: TestOrderData = {
    customerId: 'customer_test',
    items: [
      { productId: 'product_1', quantity: 1, price: 29.99 },
    ],
    total: 29.99,
    status: 'pending',
  }

  const data = { ...defaults, ...overrides }
  return stub.noun('Order').create(data)
}

/**
 * Create a test product with optional overrides
 *
 * @param stub - The DO stub to create the product on
 * @param overrides - Optional data to override defaults
 * @returns The created product ThingData
 *
 * @example
 * ```typescript
 * const product = await createTestProduct(doInstance)
 * const premiumProduct = await createTestProduct(doInstance, { price: 199.99 })
 * ```
 */
export async function createTestProduct(
  stub: DOCoreTestInstance,
  overrides?: Partial<TestProductData>
): Promise<ThingData> {
  const defaults: TestProductData = {
    name: 'Test Product',
    description: 'A test product for testing',
    price: 29.99,
    sku: `SKU-${Date.now()}`,
    category: 'test',
    inventory: 100,
    tags: ['test'],
  }

  const data = { ...defaults, ...overrides }
  return stub.noun('Product').create(data)
}

// ============================================================================
// Common Test Fixtures
// ============================================================================

/**
 * Sample customers for bulk testing
 */
export const SAMPLE_CUSTOMERS: TestCustomerData[] = [
  {
    name: 'Alice Johnson',
    email: 'alice@example.com',
    phone: '+1-555-0101',
    tags: ['premium', 'early-adopter'],
    address: {
      street: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
    },
  },
  {
    name: 'Bob Smith',
    email: 'bob@example.com',
    phone: '+1-555-0102',
    tags: ['standard'],
    address: {
      street: '456 Oak Ave',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
    },
  },
  {
    name: 'Charlie Brown',
    email: 'charlie@example.com',
    phone: '+1-555-0103',
    tags: ['new'],
  },
]

/**
 * Sample products for bulk testing
 */
export const SAMPLE_PRODUCTS: TestProductData[] = [
  {
    name: 'Widget Pro',
    description: 'Professional grade widget',
    price: 99.99,
    sku: 'WIDGET-PRO-001',
    category: 'widgets',
    inventory: 50,
    tags: ['professional', 'bestseller'],
  },
  {
    name: 'Widget Basic',
    description: 'Entry level widget',
    price: 29.99,
    sku: 'WIDGET-BASIC-001',
    category: 'widgets',
    inventory: 200,
    tags: ['entry-level'],
  },
  {
    name: 'Gadget X',
    description: 'The ultimate gadget',
    price: 199.99,
    sku: 'GADGET-X-001',
    category: 'gadgets',
    inventory: 25,
    tags: ['premium', 'limited'],
  },
]

/**
 * Sample orders for bulk testing
 */
export const SAMPLE_ORDERS: Omit<TestOrderData, 'customerId'>[] = [
  {
    items: [
      { productId: 'WIDGET-PRO-001', quantity: 2, price: 99.99 },
    ],
    total: 199.98,
    status: 'pending',
  },
  {
    items: [
      { productId: 'WIDGET-BASIC-001', quantity: 5, price: 29.99 },
    ],
    total: 149.95,
    status: 'processing',
  },
  {
    items: [
      { productId: 'GADGET-X-001', quantity: 1, price: 199.99 },
      { productId: 'WIDGET-BASIC-001', quantity: 2, price: 29.99 },
    ],
    total: 259.97,
    status: 'shipped',
  },
]

// ============================================================================
// Bulk Creation Helpers
// ============================================================================

/**
 * Create multiple customers in a single DO instance
 *
 * @param stub - The DO stub
 * @param count - Number of customers to create (uses SAMPLE_CUSTOMERS cyclically)
 * @returns Array of created customers
 */
export async function createTestCustomers(
  stub: DOCoreTestInstance,
  count: number = 3
): Promise<ThingData[]> {
  const customers: ThingData[] = []
  for (let i = 0; i < count; i++) {
    const sampleData = SAMPLE_CUSTOMERS[i % SAMPLE_CUSTOMERS.length]
    const customer = await createTestCustomer(stub, {
      ...sampleData,
      email: `${sampleData.email.split('@')[0]}-${i}@example.com`,
    })
    customers.push(customer)
  }
  return customers
}

/**
 * Create multiple products in a single DO instance
 *
 * @param stub - The DO stub
 * @param count - Number of products to create
 * @returns Array of created products
 */
export async function createTestProducts(
  stub: DOCoreTestInstance,
  count: number = 3
): Promise<ThingData[]> {
  const products: ThingData[] = []
  for (let i = 0; i < count; i++) {
    const sampleData = SAMPLE_PRODUCTS[i % SAMPLE_PRODUCTS.length]
    const product = await createTestProduct(stub, {
      ...sampleData,
      sku: `${sampleData.sku}-${i}`,
    })
    products.push(product)
  }
  return products
}

// ============================================================================
// JWT Test Helpers
// ============================================================================

/**
 * Options for creating a test JWT
 */
export interface TestJwtOptions {
  sub?: string
  permissions?: string[]
  exp?: number
  iat?: number
}

/**
 * Create a valid JWT token for testing authenticated endpoints
 *
 * This creates a properly formatted JWT with the structure the auth middleware expects.
 * Note: This is for testing purposes - signature is not cryptographically valid.
 *
 * @param options - JWT options
 * @returns JWT token string
 *
 * @example
 * ```typescript
 * const token = createTestJwt()
 * const adminToken = createTestJwt({ permissions: ['admin:users:read'] })
 * ```
 */
export function createTestJwt(options: TestJwtOptions = {}): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: options.sub ?? 'test-user',
    iat: options.iat ?? now,
    exp: options.exp ?? now + 3600, // 1 hour from now
    permissions: options.permissions ?? [],
  }

  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '')
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '')
  // For testing purposes, signature verification would require the secret
  const signature = 'test-signature'

  return `${base64Header}.${base64Payload}.${signature}`
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a thing has the expected structure
 */
export function assertValidThing(thing: unknown): asserts thing is ThingData {
  if (!thing || typeof thing !== 'object') {
    throw new Error('Expected thing to be an object')
  }
  const t = thing as Record<string, unknown>
  if (typeof t.$id !== 'string' || t.$id.length === 0) {
    throw new Error('Expected thing to have a non-empty $id')
  }
  if (typeof t.$type !== 'string' || t.$type.length === 0) {
    throw new Error('Expected thing to have a non-empty $type')
  }
}

/**
 * Assert that $type follows PascalCase convention
 */
export function assertPascalCase(type: string): void {
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(type)) {
    throw new Error(`Expected PascalCase type, got: ${type}`)
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { ThingData }
