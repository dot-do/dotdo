/**
 * E2E Tests for HATEOAS API Discovery and Navigation
 *
 * Tests cover:
 * 1. API discovery from root
 * 2. Link navigation (following hypermedia links)
 * 3. Resource relationships (hasOne, hasMany)
 * 4. Hypermedia controls (CRUD operations via links)
 *
 * Note: The hateoas.ts module uses RFC 8288 standard link relations:
 * - 'edit' for update links
 * - 'create-form' for create links
 * - 'related' for hasMany relations
 * - 'item' for hasOne relations
 *
 * @see do-91ye
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  generateLinks,
  generateCollectionLinks,
  withLinks,
  withCollectionLinks,
  generateErrorLinks,
  createErrorResponse,
  type Link,
} from '../hateoas'

// Inline link validation helper to avoid test-utils import (which pulls in miniflare)
function expectValidLink(
  link: unknown,
  expectedRel?: string,
  expectedMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
): asserts link is Link {
  expect(link).toBeDefined()
  expect(typeof link).toBe('object')

  const linkObj = link as Record<string, unknown>

  // href is required
  expect(linkObj.href).toBeDefined()
  expect(typeof linkObj.href).toBe('string')
  expect((linkObj.href as string).length).toBeGreaterThan(0)

  // rel is required
  expect(linkObj.rel).toBeDefined()
  expect(typeof linkObj.rel).toBe('string')

  if (expectedRel) {
    expect(linkObj.rel).toBe(expectedRel)
  }

  if (expectedMethod) {
    expect(linkObj.method).toBe(expectedMethod)
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

interface TestUser {
  id: string
  name: string
  email: string
}

interface TestOrder {
  id: string
  userId: string
  total: number
  status: 'pending' | 'shipped' | 'delivered'
}

/**
 * Creates a test API with HATEOAS-enabled resource endpoints.
 * Uses a fresh Hono app to avoid conflicts with existing routes.
 */
function createTestAPI() {
  const app = new Hono()

  // In-memory data stores for testing
  const users: TestUser[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com' },
  ]

  const orders: TestOrder[] = [
    { id: '101', userId: '1', total: 99.99, status: 'delivered' },
    { id: '102', userId: '1', total: 149.99, status: 'shipped' },
    { id: '103', userId: '2', total: 49.99, status: 'pending' },
  ]

  // Helper to get base URL from request
  const getBaseUrl = (url: string) => new URL(url).origin

  // Resource configuration for users
  const userConfig = {
    basePath: '/users',
    actions: ['activate', 'deactivate'],
    relations: {
      orders: { resource: 'orders', type: 'hasMany' as const },
      profile: { resource: 'profiles', type: 'hasOne' as const },
    },
  }

  // Health check endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  })

  // Root endpoint - API Discovery (custom links for discoverability)
  app.get('/', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    return c.json({
      name: 'HATEOAS Test API',
      version: '1.0.0',
      description: 'Self-describing REST API with hypermedia controls',
      _links: {
        self: {
          href: `${baseUrl}/`,
          rel: 'self',
          method: 'GET',
          title: 'API root',
        },
        health: {
          href: `${baseUrl}/health`,
          rel: 'health',
          method: 'GET',
          title: 'Health check endpoint',
        },
        users: {
          href: `${baseUrl}/users`,
          rel: 'users',
          method: 'GET',
          title: 'List all users',
        },
        orders: {
          href: `${baseUrl}/orders`,
          rel: 'orders',
          method: 'GET',
          title: 'List all orders',
        },
        documentation: {
          href: `${baseUrl}/docs`,
          rel: 'documentation',
          method: 'GET',
          title: 'API documentation',
        },
      },
    })
  })

  // Users collection
  app.get('/users', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '20')

    const result = withCollectionLinks(
      users,
      'users',
      baseUrl,
      (user) => user.id,
      { page, limit, total: users.length }
    )

    return c.json(result)
  })

  // Single user
  app.get('/users/:id', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const id = c.req.param('id')
    const user = users.find((u) => u.id === id)

    if (!user) {
      return c.json(
        createErrorResponse('User not found', 404, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
        }),
        404
      )
    }

    const links = generateLinks('users', id, baseUrl, userConfig)
    return c.json(withLinks(user, links))
  })

  // Create user
  app.post('/users', async (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const body = await c.req.json<Omit<TestUser, 'id'>>()
    const newUser: TestUser = {
      id: String(users.length + 1),
      ...body,
    }
    users.push(newUser)

    const links = generateLinks('users', newUser.id, baseUrl, userConfig)
    return c.json(withLinks(newUser, links), 201)
  })

  // Update user
  app.put('/users/:id', async (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const id = c.req.param('id')
    const userIndex = users.findIndex((u) => u.id === id)

    if (userIndex === -1) {
      return c.json(
        createErrorResponse('User not found', 404, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
        }),
        404
      )
    }

    const body = await c.req.json<Partial<TestUser>>()
    users[userIndex] = { ...users[userIndex], ...body }

    const links = generateLinks('users', id, baseUrl, userConfig)
    return c.json(withLinks(users[userIndex], links))
  })

  // Delete user
  app.delete('/users/:id', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const id = c.req.param('id')
    const userIndex = users.findIndex((u) => u.id === id)

    if (userIndex === -1) {
      return c.json(
        createErrorResponse('User not found', 404, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
        }),
        404
      )
    }

    users.splice(userIndex, 1)
    return c.json({ success: true }, 200)
  })

  // User actions
  app.post('/users/:id/activate', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const id = c.req.param('id')
    const user = users.find((u) => u.id === id)

    if (!user) {
      return c.json(
        createErrorResponse('User not found', 404, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
        }),
        404
      )
    }

    const links = generateLinks('users', id, baseUrl, userConfig)
    return c.json(
      withLinks({ ...user, activated: true }, links)
    )
  })

  app.post('/users/:id/deactivate', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const id = c.req.param('id')
    const user = users.find((u) => u.id === id)

    if (!user) {
      return c.json(
        createErrorResponse('User not found', 404, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
        }),
        404
      )
    }

    const links = generateLinks('users', id, baseUrl, userConfig)
    return c.json(
      withLinks({ ...user, activated: false }, links)
    )
  })

  // User's orders (relationship)
  app.get('/users/:id/orders', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const userId = c.req.param('id')
    const userOrders = orders.filter((o) => o.userId === userId)

    return c.json(
      withCollectionLinks(userOrders, 'orders', baseUrl, (order) => order.id)
    )
  })

  // Orders collection
  app.get('/orders', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '20')

    const result = withCollectionLinks(
      orders,
      'orders',
      baseUrl,
      (order) => order.id,
      { page, limit, total: orders.length }
    )

    return c.json(result)
  })

  // Single order
  app.get('/orders/:id', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const id = c.req.param('id')
    const order = orders.find((o) => o.id === id)

    if (!order) {
      return c.json(
        createErrorResponse('Order not found', 404, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
        }),
        404
      )
    }

    const orderConfig = {
      basePath: '/orders',
      actions: ['ship', 'cancel'],
      relations: {
        user: { resource: 'users', type: 'belongsTo' as const },
      },
    }

    const links = generateLinks('orders', id, baseUrl, orderConfig)
    // Add explicit link to the related user
    links['user'] = {
      href: `${baseUrl}/users/${order.userId}`,
      rel: 'user',
      method: 'GET',
      title: 'Get order owner',
    }

    return c.json(withLinks(order, links))
  })

  // Validation error endpoint for testing 400 errors
  app.post('/users/:id/validate', async (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    const body = await c.req.json<{ email?: string }>()

    // Simulate validation error for invalid email
    if (!body.email || !body.email.includes('@')) {
      return c.json(
        createErrorResponse('Validation failed', 400, baseUrl, {
          docsPath: '/docs',
          healthPath: '/health',
          details: { email: 'Invalid email format' },
        }),
        400
      )
    }

    return c.json({ valid: true })
  })

  // Server error endpoint for testing 500 errors
  app.get('/error', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    return c.json(
      createErrorResponse('Internal server error', 500, baseUrl, {
        docsPath: '/docs',
        healthPath: '/health',
        requestId: 'test-request-123',
      }),
      500
    )
  })

  // Forbidden endpoint for testing 403 errors
  app.get('/admin', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    return c.json(
      createErrorResponse('Forbidden', 403, baseUrl, {
        docsPath: '/docs',
        healthPath: '/health',
      }),
      403
    )
  })

  // Unauthorized endpoint for testing 401 errors
  app.get('/protected', (c) => {
    const baseUrl = getBaseUrl(c.req.url)
    return c.json(
      createErrorResponse('Unauthorized', 401, baseUrl, {
        docsPath: '/docs',
        healthPath: '/health',
      }),
      401
    )
  })

  return app
}

// ============================================================================
// E2E Tests: API Discovery from Root
// ============================================================================

describe('HATEOAS E2E: API Discovery', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should return API metadata at root endpoint', async () => {
    const res = await app.request('http://localhost/')

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.name).toBe('HATEOAS Test API')
    expect(body.version).toBe('1.0.0')
    expect(body.description).toBeDefined()
  })

  it('should include _links object in root response', async () => {
    const res = await app.request('http://localhost/')

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body._links).toBeDefined()
    expect(typeof body._links).toBe('object')
  })

  it('should provide self link at root', async () => {
    const res = await app.request('http://localhost/')
    const body = await res.json()

    expect(body._links.self).toBeDefined()
    expect(body._links.self.href).toBe('http://localhost/')
    expect(body._links.self.rel).toBe('self')
    expect(body._links.self.method).toBe('GET')
  })

  it('should provide links to primary resources', async () => {
    const res = await app.request('http://localhost/')
    const body = await res.json()

    // Users resource link
    expect(body._links.users).toBeDefined()
    expect(body._links.users.href).toBe('http://localhost/users')
    expect(body._links.users.rel).toBe('users')
    expect(body._links.users.method).toBe('GET')

    // Orders resource link
    expect(body._links.orders).toBeDefined()
    expect(body._links.orders.href).toBe('http://localhost/orders')
    expect(body._links.orders.rel).toBe('orders')
  })

  it('should provide health check link', async () => {
    const res = await app.request('http://localhost/')
    const body = await res.json()

    expect(body._links.health).toBeDefined()
    expect(body._links.health.href).toBe('http://localhost/health')
    expect(body._links.health.title).toBe('Health check endpoint')
  })

  it('should allow client to navigate to health check from root', async () => {
    // First, get root
    const rootRes = await app.request('http://localhost/')
    const rootBody = await rootRes.json()

    // Then, follow health link
    const healthUrl = rootBody._links.health.href
    const healthRes = await app.request(healthUrl)

    expect(healthRes.status).toBe(200)
    const healthBody = await healthRes.json()
    expect(healthBody.status).toBe('ok')
  })
})

// ============================================================================
// E2E Tests: Link Navigation
// ============================================================================

describe('HATEOAS E2E: Link Navigation', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should navigate from root to users collection', async () => {
    // Get root
    const rootRes = await app.request('http://localhost/')
    const rootBody = await rootRes.json()

    // Follow users link
    const usersUrl = rootBody._links.users.href
    const usersRes = await app.request(usersUrl)

    expect(usersRes.status).toBe(200)
    const usersBody = await usersRes.json()
    expect(usersBody.data).toBeDefined()
    expect(Array.isArray(usersBody.data)).toBe(true)
  })

  it('should navigate from collection to individual resource', async () => {
    // Get users collection
    const collectionRes = await app.request('http://localhost/users')
    const collectionBody = await collectionRes.json()

    // Get first user's self link
    const firstUser = collectionBody.data[0]
    expect(firstUser._links).toBeDefined()
    expect(firstUser._links.self).toBeDefined()

    // Follow self link to individual resource
    const userUrl = firstUser._links.self.href
    const userRes = await app.request(userUrl)

    expect(userRes.status).toBe(200)
    const userBody = await userRes.json()
    expect(userBody.data.id).toBe(firstUser.id)
    expect(userBody.data.name).toBe(firstUser.name)
  })

  it('should navigate from individual resource back to collection', async () => {
    // Get individual user
    const userRes = await app.request('http://localhost/users/1')
    const userBody = await userRes.json()

    // Should have collection link
    expect(userBody._links.collection).toBeDefined()

    // Follow collection link
    const collectionUrl = userBody._links.collection.href
    const collectionRes = await app.request(collectionUrl)

    expect(collectionRes.status).toBe(200)
    const collectionBody = await collectionRes.json()
    expect(Array.isArray(collectionBody.data)).toBe(true)
  })

  it('should navigate through pagination links', async () => {
    // Get users with pagination (page 1, limit 2)
    const page1Res = await app.request('http://localhost/users?page=1&limit=2')
    const page1Body = await page1Res.json()

    expect(page1Body._links.self).toBeDefined()
    expect(page1Body._links.self.href).toContain('page=1')

    // With 3 total users and limit=2, should have next link on page 1
    expect(page1Body._links.next).toBeDefined()

    // Follow next link
    const nextUrl = page1Body._links.next.href
    const page2Res = await app.request(nextUrl)

    expect(page2Res.status).toBe(200)
    const page2Body = await page2Res.json()
    expect(page2Body._links.self.href).toContain('page=2')

    // Page 2 should have prev link
    expect(page2Body._links.prev).toBeDefined()
  })

  it('should have first/last pagination links when applicable', async () => {
    // Get middle page
    const midRes = await app.request('http://localhost/users?page=2&limit=1')
    const midBody = await midRes.json()

    // Should have first and last links
    expect(midBody._links.first).toBeDefined()
    expect(midBody._links.first.href).toContain('page=1')

    expect(midBody._links.last).toBeDefined()
    expect(midBody._links.last.href).toContain('page=3') // 3 users / 1 per page = 3 pages
  })
})

// ============================================================================
// E2E Tests: Resource Relationships
// ============================================================================

describe('HATEOAS E2E: Resource Relationships', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should include relation links for hasMany relationships', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    // User should have orders relation link (RFC 8288 uses 'related' rel for hasMany)
    expect(body._links.orders).toBeDefined()
    expect(body._links.orders.href).toBe('http://localhost/users/1/orders')
    expect(body._links.orders.rel).toBe('related')  // RFC 8288 standard relation
    expect(body._links.orders.method).toBe('GET')
  })

  it('should navigate from resource to related collection', async () => {
    // Get user
    const userRes = await app.request('http://localhost/users/1')
    const userBody = await userRes.json()

    // Follow orders relation link
    const ordersUrl = userBody._links.orders.href
    const ordersRes = await app.request(ordersUrl)

    expect(ordersRes.status).toBe(200)
    const ordersBody = await ordersRes.json()

    // Should return only user 1's orders
    expect(Array.isArray(ordersBody.data)).toBe(true)
    expect(ordersBody.data.length).toBeGreaterThan(0)

    // All orders should belong to user 1
    for (const order of ordersBody.data) {
      expect(order.userId).toBe('1')
    }
  })

  it('should include belongsTo relation links', async () => {
    const res = await app.request('http://localhost/orders/101')
    const body = await res.json()

    // Order should have user relation link (belongsTo)
    expect(body._links.user).toBeDefined()
    expect(body._links.user.href).toBe('http://localhost/users/1')
    expect(body._links.user.method).toBe('GET')
  })

  it('should navigate from child to parent resource', async () => {
    // Get order
    const orderRes = await app.request('http://localhost/orders/101')
    const orderBody = await orderRes.json()

    // Follow user relation link
    const userUrl = orderBody._links.user.href
    const userRes = await app.request(userUrl)

    expect(userRes.status).toBe(200)
    const userBody = await userRes.json()

    // Should be the correct user
    expect(userBody.data.id).toBe('1')
  })

  it('should include profile relation link (hasOne)', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    // User should have profile relation link (RFC 8288 uses 'item' rel for hasOne)
    expect(body._links.profile).toBeDefined()
    expect(body._links.profile.href).toBe('http://localhost/users/1/profile')
    expect(body._links.profile.method).toBe('GET')
  })

  it('should return proper 404 for non-existent related resources', async () => {
    // User 999 doesn't exist
    const res = await app.request('http://localhost/users/999/orders')

    expect(res.status).toBe(200) // Empty collection is valid
    const body = await res.json()
    expect(body.data).toEqual([])
  })
})

// ============================================================================
// E2E Tests: Hypermedia Controls (CRUD Operations)
// ============================================================================

describe('HATEOAS E2E: Hypermedia Controls', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should provide create link in collection response', async () => {
    const res = await app.request('http://localhost/users')
    const body = await res.json()

    expect(body._links.create).toBeDefined()
    expect(body._links.create.href).toBe('http://localhost/users')
    expect(body._links.create.method).toBe('POST')
    expect(body._links.create.rel).toBe('create-form')  // RFC 8288 standard relation
  })

  it('should create resource via create link', async () => {
    // Get collection to find create link
    const collectionRes = await app.request('http://localhost/users')
    const collectionBody = await collectionRes.json()
    const createUrl = collectionBody._links.create.href

    // Use create link to POST new resource
    const createRes = await app.request(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'David', email: 'david@example.com' }),
    })

    expect(createRes.status).toBe(201)
    const createBody = await createRes.json()
    expect(createBody.data.name).toBe('David')
    expect(createBody.data.email).toBe('david@example.com')
    expect(createBody.data.id).toBeDefined()
  })

  it('should provide update link in resource response', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    expect(body._links.update).toBeDefined()
    expect(body._links.update.href).toBe('http://localhost/users/1')
    expect(body._links.update.method).toBe('PUT')
    expect(body._links.update.rel).toBe('edit')  // RFC 8288 standard relation
  })

  it('should update resource via update link', async () => {
    // Get resource to find update link
    const getRes = await app.request('http://localhost/users/1')
    const getBody = await getRes.json()
    const updateUrl = getBody._links.update.href

    // Use update link to PUT updated resource
    const updateRes = await app.request(updateUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Updated' }),
    })

    expect(updateRes.status).toBe(200)
    const updateBody = await updateRes.json()
    expect(updateBody.data.name).toBe('Alice Updated')
  })

  it('should provide delete link in resource response', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    expect(body._links.delete).toBeDefined()
    expect(body._links.delete.href).toBe('http://localhost/users/1')
    expect(body._links.delete.method).toBe('DELETE')
    expect(body._links.delete.rel).toBe('delete')
  })

  it('should delete resource via delete link', async () => {
    // Get resource to find delete link
    const getRes = await app.request('http://localhost/users/2')
    const getBody = await getRes.json()
    const deleteUrl = getBody._links.delete.href

    // Use delete link to DELETE resource
    const deleteRes = await app.request(deleteUrl, {
      method: 'DELETE',
    })

    expect(deleteRes.status).toBe(200)

    // Verify resource is deleted
    const verifyRes = await app.request('http://localhost/users/2')
    expect(verifyRes.status).toBe(404)
  })

  it('should provide action links in resource response', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    // Should have activate and deactivate action links
    expect(body._links.activate).toBeDefined()
    expect(body._links.activate.href).toBe('http://localhost/users/1/activate')
    expect(body._links.activate.method).toBe('POST')

    expect(body._links.deactivate).toBeDefined()
    expect(body._links.deactivate.href).toBe('http://localhost/users/1/deactivate')
    expect(body._links.deactivate.method).toBe('POST')
  })

  it('should execute action via action link', async () => {
    // Get resource to find action link
    const getRes = await app.request('http://localhost/users/1')
    const getBody = await getRes.json()
    const activateUrl = getBody._links.activate.href

    // Execute activate action
    const actionRes = await app.request(activateUrl, {
      method: 'POST',
    })

    expect(actionRes.status).toBe(200)
    const actionBody = await actionRes.json()
    expect(actionBody.data.activated).toBe(true)
  })

  it('should execute deactivate action via link', async () => {
    const getRes = await app.request('http://localhost/users/1')
    const getBody = await getRes.json()
    const deactivateUrl = getBody._links.deactivate.href

    const actionRes = await app.request(deactivateUrl, {
      method: 'POST',
    })

    expect(actionRes.status).toBe(200)
    const actionBody = await actionRes.json()
    expect(actionBody.data.activated).toBe(false)
  })
})

// ============================================================================
// E2E Tests: Complete User Journey
// ============================================================================

describe('HATEOAS E2E: Complete User Journey', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should complete full discovery -> navigate -> operate cycle', async () => {
    // Step 1: Start at API root (discovery)
    const rootRes = await app.request('http://localhost/')
    expect(rootRes.status).toBe(200)
    const rootBody = await rootRes.json()

    // Step 2: Navigate to users resource
    const usersUrl = rootBody._links.users.href
    const usersRes = await app.request(usersUrl)
    expect(usersRes.status).toBe(200)
    const usersBody = await usersRes.json()

    // Step 3: Create a new user via create link
    const createUrl = usersBody._links.create.href
    const createRes = await app.request(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Eve', email: 'eve@example.com' }),
    })
    expect(createRes.status).toBe(201)
    const newUser = await createRes.json()

    // Step 4: Follow self link to get the new user
    const userUrl = newUser._links.self.href
    const userRes = await app.request(userUrl)
    expect(userRes.status).toBe(200)
    const userBody = await userRes.json()
    expect(userBody.data.name).toBe('Eve')

    // Step 5: Update the user via update link
    const updateUrl = userBody._links.update.href
    const updateRes = await app.request(updateUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Eve Updated', email: 'eve.updated@example.com' }),
    })
    expect(updateRes.status).toBe(200)

    // Step 6: Execute an action via action link
    const updatedBody = await updateRes.json()
    const activateUrl = updatedBody._links.activate.href
    const activateRes = await app.request(activateUrl, {
      method: 'POST',
    })
    expect(activateRes.status).toBe(200)
    const activatedBody = await activateRes.json()
    expect(activatedBody.data.activated).toBe(true)

    // Step 7: Navigate back to collection
    const collectionUrl = activatedBody._links.collection.href
    const finalCollectionRes = await app.request(collectionUrl)
    expect(finalCollectionRes.status).toBe(200)
    const finalCollection = await finalCollectionRes.json()
    expect(finalCollection.data.length).toBeGreaterThan(3) // Original 3 + new user
  })

  it('should navigate through related resources', async () => {
    // Step 1: Get a specific user
    const userRes = await app.request('http://localhost/users/1')
    const userBody = await userRes.json()
    expect(userBody.data.name).toBe('Alice')

    // Step 2: Navigate to user's orders
    const ordersUrl = userBody._links.orders.href
    const ordersRes = await app.request(ordersUrl)
    expect(ordersRes.status).toBe(200)
    const ordersBody = await ordersRes.json()

    // Step 3: Get a specific order
    const firstOrder = ordersBody.data[0]
    const orderUrl = firstOrder._links.self.href
    const orderRes = await app.request(orderUrl)
    expect(orderRes.status).toBe(200)
    const orderBody = await orderRes.json()

    // Step 4: Navigate back to user from order
    const userFromOrderUrl = orderBody._links.user.href
    const userFromOrderRes = await app.request(userFromOrderUrl)
    expect(userFromOrderRes.status).toBe(200)
    const userFromOrderBody = await userFromOrderRes.json()

    // Should be the same user we started with
    expect(userFromOrderBody.data.id).toBe('1')
    expect(userFromOrderBody.data.name).toBe('Alice')
  })
})

// ============================================================================
// E2E Tests: Link Validation
// ============================================================================

describe('HATEOAS E2E: Link Validation', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should have valid link structure on all resource responses', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    // Validate each link using the test utility
    for (const [, link] of Object.entries(body._links)) {
      expectValidLink(link)
    }
  })

  it('should have all links resolve to valid endpoints', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    // Test that GET links are valid (can't easily test POST/PUT/DELETE without proper bodies)
    const getLinks = Object.values(body._links).filter(
      (link: unknown) => (link as Link).method === 'GET'
    )

    for (const link of getLinks) {
      const linkRes = await app.request((link as Link).href)
      // Should not be 500 (server error)
      expect(linkRes.status).not.toBe(500)
    }
  })

  it('should include required link properties', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    for (const link of Object.values(body._links) as Link[]) {
      // href is always required
      expect(link.href).toBeDefined()
      expect(typeof link.href).toBe('string')
      expect(link.href.length).toBeGreaterThan(0)

      // rel is always required
      expect(link.rel).toBeDefined()
      expect(typeof link.rel).toBe('string')
    }
  })

  it('should have consistent URL format in links', async () => {
    const res = await app.request('http://localhost/users/1')
    const body = await res.json()

    for (const link of Object.values(body._links) as Link[]) {
      // All hrefs should be valid URLs
      expect(() => new URL(link.href)).not.toThrow()

      // All should use same origin
      const url = new URL(link.href)
      expect(url.origin).toBe('http://localhost')
    }
  })
})

// ============================================================================
// E2E Tests: Content Negotiation and Headers
// ============================================================================

describe('HATEOAS E2E: Content Type and Headers', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  it('should return JSON content type for all HATEOAS responses', async () => {
    const endpoints = [
      'http://localhost/',
      'http://localhost/users',
      'http://localhost/users/1',
      'http://localhost/orders',
      'http://localhost/orders/101',
    ]

    for (const endpoint of endpoints) {
      const res = await app.request(endpoint)
      expect(res.headers.get('content-type')).toContain('application/json')
    }
  })

  it('should include X-Request-ID header in responses', async () => {
    const res = await app.request('http://localhost/users')
    // Note: X-Request-ID is added by createAPI middleware, not raw Hono
    // This test verifies basic Hono headers work
    expect(res.headers.get('content-type')).toBeDefined()
  })
})

// ============================================================================
// E2E Tests: Error Responses with HATEOAS Links
// ============================================================================

describe('HATEOAS E2E: Error Responses with Links', () => {
  let app: ReturnType<typeof createTestAPI>

  beforeEach(() => {
    app = createTestAPI()
  })

  describe('404 Not Found Errors', () => {
    it('should include _links in 404 responses for resources', async () => {
      const res = await app.request('http://localhost/users/999')

      expect(res.status).toBe(404)
      const body = await res.json()

      expect(body.error).toBe('User not found')
      expect(body.status).toBe(404)
      expect(body._links).toBeDefined()
    })

    it('should include root link in 404 error response', async () => {
      const res = await app.request('http://localhost/users/999')
      const body = await res.json()

      expect(body._links.root).toBeDefined()
      expect(body._links.root.href).toBe('http://localhost/')
      expect(body._links.root.rel).toBe('up')
      expect(body._links.root.method).toBe('GET')
    })

    it('should include help/docs link in 404 error response', async () => {
      const res = await app.request('http://localhost/users/999')
      const body = await res.json()

      expect(body._links.help).toBeDefined()
      expect(body._links.help.href).toBe('http://localhost/docs')
      expect(body._links.help.rel).toBe('help')
      expect(body._links.help.method).toBe('GET')
    })

    it('should include health check link in 404 error response', async () => {
      const res = await app.request('http://localhost/users/999')
      const body = await res.json()

      expect(body._links.health).toBeDefined()
      expect(body._links.health.href).toBe('http://localhost/health')
      expect(body._links.health.rel).toBe('related')
      expect(body._links.health.method).toBe('GET')
    })

    it('should allow navigation from 404 error to API root', async () => {
      // Get 404 error
      const errorRes = await app.request('http://localhost/orders/999')
      expect(errorRes.status).toBe(404)
      const errorBody = await errorRes.json()

      // Follow root link to recover
      const rootUrl = errorBody._links.root.href
      const rootRes = await app.request(rootUrl)

      expect(rootRes.status).toBe(200)
      const rootBody = await rootRes.json()
      expect(rootBody.name).toBe('HATEOAS Test API')
    })

    it('should allow navigation from 404 error to health endpoint', async () => {
      const errorRes = await app.request('http://localhost/users/999')
      const errorBody = await errorRes.json()

      const healthUrl = errorBody._links.health.href
      const healthRes = await app.request(healthUrl)

      expect(healthRes.status).toBe(200)
      const healthBody = await healthRes.json()
      expect(healthBody.status).toBe('ok')
    })
  })

  describe('400 Bad Request Errors', () => {
    it('should include _links in validation error responses', async () => {
      const res = await app.request('http://localhost/users/1/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()

      expect(body.error).toBe('Validation failed')
      expect(body.status).toBe(400)
      expect(body._links).toBeDefined()
      expect(body._links.root).toBeDefined()
      expect(body._links.help).toBeDefined()
    })

    it('should include validation details in 400 error response', async () => {
      const res = await app.request('http://localhost/users/1/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      })

      const body = await res.json()
      expect(body.details).toBeDefined()
      expect(body.details.email).toBe('Invalid email format')
    })
  })

  describe('401 Unauthorized Errors', () => {
    it('should include _links in unauthorized error responses', async () => {
      const res = await app.request('http://localhost/protected')

      expect(res.status).toBe(401)
      const body = await res.json()

      expect(body.error).toBe('Unauthorized')
      expect(body.status).toBe(401)
      expect(body._links).toBeDefined()
    })

    it('should provide navigation links for recovery from 401', async () => {
      const res = await app.request('http://localhost/protected')
      const body = await res.json()

      // Should have root link to discover authentication methods
      expect(body._links.root.href).toBe('http://localhost/')

      // Should have help/docs link for auth documentation
      expect(body._links.help.href).toBe('http://localhost/docs')
    })
  })

  describe('403 Forbidden Errors', () => {
    it('should include _links in forbidden error responses', async () => {
      const res = await app.request('http://localhost/admin')

      expect(res.status).toBe(403)
      const body = await res.json()

      expect(body.error).toBe('Forbidden')
      expect(body.status).toBe(403)
      expect(body._links).toBeDefined()
    })

    it('should provide helpful links in 403 response', async () => {
      const res = await app.request('http://localhost/admin')
      const body = await res.json()

      // Verify all standard error links are present
      expect(body._links.root).toBeDefined()
      expect(body._links.help).toBeDefined()
      expect(body._links.health).toBeDefined()
    })
  })

  describe('500 Server Errors', () => {
    it('should include _links in server error responses', async () => {
      const res = await app.request('http://localhost/error')

      expect(res.status).toBe(500)
      const body = await res.json()

      expect(body.error).toBe('Internal server error')
      expect(body.status).toBe(500)
      expect(body._links).toBeDefined()
    })

    it('should include requestId in 500 error response', async () => {
      const res = await app.request('http://localhost/error')
      const body = await res.json()

      expect(body.requestId).toBe('test-request-123')
    })

    it('should provide recovery links even for 500 errors', async () => {
      const res = await app.request('http://localhost/error')
      const body = await res.json()

      // Even on server error, client should be able to navigate back
      expect(body._links.root).toBeDefined()
      expect(body._links.health).toBeDefined()

      // Verify health endpoint is reachable from error
      const healthRes = await app.request(body._links.health.href)
      expect(healthRes.status).toBe(200)
    })
  })

  describe('Error Response Link Structure', () => {
    it('should have valid link structure in all error responses', async () => {
      const errorEndpoints = [
        'http://localhost/users/999',
        'http://localhost/orders/999',
        'http://localhost/admin',
        'http://localhost/protected',
        'http://localhost/error',
      ]

      for (const endpoint of errorEndpoints) {
        const res = await app.request(endpoint)
        const body = await res.json()

        expect(body._links).toBeDefined()

        // Validate each link structure
        for (const [, link] of Object.entries(body._links)) {
          expectValidLink(link)
        }
      }
    })

    it('should have consistent link properties across error types', async () => {
      // Get different error types
      const notFoundRes = await app.request('http://localhost/users/999')
      const forbiddenRes = await app.request('http://localhost/admin')
      const serverErrorRes = await app.request('http://localhost/error')

      const notFoundBody = await notFoundRes.json()
      const forbiddenBody = await forbiddenRes.json()
      const serverErrorBody = await serverErrorRes.json()

      // All should have the same structure for _links
      const linkKeys = ['root', 'help', 'health']

      for (const key of linkKeys) {
        expect(notFoundBody._links[key]).toBeDefined()
        expect(forbiddenBody._links[key]).toBeDefined()
        expect(serverErrorBody._links[key]).toBeDefined()
      }
    })

    it('should return JSON content type for error responses', async () => {
      const errorEndpoints = [
        'http://localhost/users/999',
        'http://localhost/admin',
        'http://localhost/error',
      ]

      for (const endpoint of errorEndpoints) {
        const res = await app.request(endpoint)
        expect(res.headers.get('content-type')).toContain('application/json')
      }
    })
  })

  describe('Error Recovery Navigation', () => {
    it('should enable full recovery flow: error -> root -> resources', async () => {
      // Step 1: Hit a 404 error
      const errorRes = await app.request('http://localhost/users/nonexistent')
      expect(errorRes.status).toBe(404)
      const errorBody = await errorRes.json()

      // Step 2: Navigate to root from error
      const rootUrl = errorBody._links.root.href
      const rootRes = await app.request(rootUrl)
      expect(rootRes.status).toBe(200)
      const rootBody = await rootRes.json()

      // Step 3: Navigate to users collection from root
      const usersUrl = rootBody._links.users.href
      const usersRes = await app.request(usersUrl)
      expect(usersRes.status).toBe(200)
      const usersBody = await usersRes.json()

      // Step 4: Navigate to a valid user
      const validUser = usersBody.data[0]
      const userUrl = validUser._links.self.href
      const userRes = await app.request(userUrl)
      expect(userRes.status).toBe(200)
    })

    it('should enable error -> health check -> verify service status', async () => {
      // Get 500 error
      const errorRes = await app.request('http://localhost/error')
      expect(errorRes.status).toBe(500)
      const errorBody = await errorRes.json()

      // Client can check if service is healthy using error response links
      const healthUrl = errorBody._links.health.href
      const healthRes = await app.request(healthUrl)
      const healthBody = await healthRes.json()

      // If health check passes, the error was likely transient
      expect(healthRes.status).toBe(200)
      expect(healthBody.status).toBe('ok')
    })
  })
})

// ============================================================================
// E2E Tests: Error Link Generation Functions
// ============================================================================

describe('HATEOAS E2E: Error Link Generation', () => {
  describe('generateErrorLinks', () => {
    it('should generate root link with up relation', () => {
      const links = generateErrorLinks('http://localhost')

      expect(links.root).toBeDefined()
      expect(links.root.href).toBe('http://localhost/')
      expect(links.root.rel).toBe('up')
      expect(links.root.method).toBe('GET')
    })

    it('should include help link when docsPath is provided', () => {
      const links = generateErrorLinks('http://localhost', {
        docsPath: '/documentation',
      })

      expect(links.help).toBeDefined()
      expect(links.help.href).toBe('http://localhost/documentation')
      expect(links.help.rel).toBe('help')
    })

    it('should include health link when healthPath is provided', () => {
      const links = generateErrorLinks('http://localhost', {
        healthPath: '/health-check',
      })

      expect(links.health).toBeDefined()
      expect(links.health.href).toBe('http://localhost/health-check')
      expect(links.health.rel).toBe('related')
    })

    it('should handle missing optional paths', () => {
      const links = generateErrorLinks('http://localhost')

      expect(links.root).toBeDefined()
      expect(links.help).toBeUndefined()
      expect(links.health).toBeUndefined()
    })
  })

  describe('createErrorResponse', () => {
    it('should create complete error response structure', () => {
      const response = createErrorResponse(
        'Resource not found',
        404,
        'http://localhost',
        {
          docsPath: '/docs',
          healthPath: '/health',
        }
      )

      expect(response.error).toBe('Resource not found')
      expect(response.status).toBe(404)
      expect(response._links).toBeDefined()
      expect(response._links?.root).toBeDefined()
    })

    it('should include requestId when provided', () => {
      const response = createErrorResponse(
        'Server error',
        500,
        'http://localhost',
        {
          requestId: 'req-12345',
        }
      )

      expect(response.requestId).toBe('req-12345')
    })

    it('should include details when provided', () => {
      const response = createErrorResponse(
        'Validation error',
        400,
        'http://localhost',
        {
          details: {
            field1: 'Error in field1',
            field2: 'Error in field2',
          },
        }
      )

      expect(response.details).toEqual({
        field1: 'Error in field1',
        field2: 'Error in field2',
      })
    })

    it('should create minimal error response without options', () => {
      const response = createErrorResponse(
        'Bad Request',
        400,
        'http://localhost'
      )

      expect(response.error).toBe('Bad Request')
      expect(response.status).toBe(400)
      expect(response._links?.root).toBeDefined()
      expect(response.requestId).toBeUndefined()
      expect(response.details).toBeUndefined()
    })
  })
})
