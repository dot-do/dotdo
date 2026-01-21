# HATEOAS API

The `@dotdo/api` package implements Hypermedia as the Engine of Application State (HATEOAS) principles, making APIs self-describing and discoverable.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Link Structure](#link-structure)
- [API Root](#api-root)
- [Resource Links](#resource-links)
- [Collection Links](#collection-links)
- [Error Responses](#error-responses)
- [URL Validation and Security](#url-validation-and-security)
- [Integration with Hono](#integration-with-hono)
- [Best Practices](#best-practices)

## Overview

HATEOAS is a constraint of REST architecture that makes APIs self-documenting. Instead of hardcoding URLs, clients discover available actions through links in responses. Benefits include:

- **Discoverability**: Clients can navigate the API from a single entry point
- **Evolvability**: URLs can change without breaking clients
- **Documentation**: Links describe what actions are available
- **State Management**: Links reflect current resource state

## Quick Start

### Basic HATEOAS Response

```typescript
import {
  generateLinks,
  withLinks,
  generateCollectionLinks,
  withCollectionLinks
} from '@dotdo/api'

// Single resource with links
const customer = { $id: 'cust-123', name: 'Alice', email: 'alice@example.com' }
const links = generateLinks('customers', customer.$id, 'https://api.example.com')

const response = withLinks(customer, links)
// {
//   data: { $id: 'cust-123', name: 'Alice', email: 'alice@example.com' },
//   _links: {
//     self: { href: 'https://api.example.com/customers/cust-123', rel: 'self', method: 'GET' },
//     update: { href: 'https://api.example.com/customers/cust-123', rel: 'edit', method: 'PUT' },
//     delete: { href: 'https://api.example.com/customers/cust-123', rel: 'delete', method: 'DELETE' },
//     collection: { href: 'https://api.example.com/customers', rel: 'collection', method: 'GET' }
//   }
// }
```

### Collection with Links

```typescript
const customers = [
  { $id: 'cust-1', name: 'Alice' },
  { $id: 'cust-2', name: 'Bob' }
]

const response = withCollectionLinks(
  customers,
  'customers',
  'https://api.example.com',
  (c) => c.$id,  // ID extractor
  { page: 1, limit: 20, total: 100 }
)

// {
//   data: [
//     { $id: 'cust-1', name: 'Alice', _links: { self: {...}, update: {...}, ... } },
//     { $id: 'cust-2', name: 'Bob', _links: { self: {...}, update: {...}, ... } }
//   ],
//   _links: {
//     self: { href: '...?page=1&limit=20', rel: 'self' },
//     create: { href: '...', rel: 'create-form', method: 'POST' },
//     next: { href: '...?page=2&limit=20', rel: 'next' },
//     last: { href: '...?page=5&limit=20', rel: 'last' }
//   }
// }
```

## Link Structure

Each link follows RFC 8288 (Web Linking):

```typescript
interface Link {
  href: string      // URL to the linked resource
  rel: string       // Link relation type (RFC 8288)
  method?: string   // HTTP method ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
  title?: string    // Human-readable title
  type?: string     // Media type hint
  name?: string     // Link name for disambiguation
}
```

### Standard Relation Types (RFC 8288)

| Relation | Description | Use Case |
|----------|-------------|----------|
| `self` | Current resource | Every resource response |
| `collection` | Parent collection | Single resource |
| `item` | Item in collection | hasOne relations |
| `related` | Related resource | hasMany relations |
| `edit` | Editable version | Update endpoint |
| `delete` | Deletion endpoint | Delete action |
| `create-form` | Creation endpoint | Collection POST |
| `first` | First page | Pagination |
| `prev` | Previous page | Pagination |
| `next` | Next page | Pagination |
| `last` | Last page | Pagination |
| `up` | Parent resource | Navigation to root |
| `help` | Documentation | API docs link |
| `describedby` | Description/schema | OpenAPI spec |

## API Root

The API root provides a discoverable entry point:

### Generating API Root

```typescript
import { generateAPIRoot, generateAPIRootLinks } from '@dotdo/api'

const root = generateAPIRoot({
  name: 'My API',
  version: '1.0.0',
  description: 'E-commerce API with full HATEOAS support',
  baseUrl: 'https://api.example.com',
  resources: {
    customers: { path: '/customers', title: 'Customer management' },
    orders: { path: '/orders', title: 'Order management' },
    products: { path: '/products', title: 'Product catalog' }
  },
  openapi: {
    json: '/openapi.json',
    yaml: '/openapi.yaml'
  },
  docsPath: '/docs',
  healthPath: '/health'
})

// Response:
// {
//   name: 'My API',
//   version: '1.0.0',
//   description: 'E-commerce API with full HATEOAS support',
//   _links: {
//     self: { href: 'https://api.example.com/', rel: 'self' },
//     health: { href: 'https://api.example.com/health', rel: 'health' },
//     describedby: { href: 'https://api.example.com/openapi.json', rel: 'describedby' },
//     help: { href: 'https://api.example.com/docs', rel: 'help' },
//     customers: { href: 'https://api.example.com/customers', rel: 'collection' },
//     orders: { href: 'https://api.example.com/orders', rel: 'collection' },
//     products: { href: 'https://api.example.com/products', rel: 'collection' }
//   }
// }
```

### API Root Configuration

```typescript
interface APIRootConfig {
  // API metadata
  name?: string
  version?: string
  description?: string

  // Base URL (required)
  baseUrl: string

  // Resource collection links
  resources?: Record<string, {
    path: string
    title?: string
    description?: string
  }>

  // OpenAPI specification paths
  openapi?: {
    json?: string
    yaml?: string
  }

  // Additional endpoints
  docsPath?: string
  healthPath?: string
}
```

## Resource Links

### Basic Resource Links

```typescript
import { generateLinks } from '@dotdo/api'

const links = generateLinks(
  'customers',           // Resource name
  'cust-123',           // Resource ID
  'https://api.example.com'
)

// Generated links:
// {
//   self: { href: '.../customers/cust-123', rel: 'self', method: 'GET', title: 'Get customers' },
//   update: { href: '.../customers/cust-123', rel: 'edit', method: 'PUT', title: 'Update customers' },
//   delete: { href: '.../customers/cust-123', rel: 'delete', method: 'DELETE', title: 'Delete customers' },
//   collection: { href: '.../customers', rel: 'collection', method: 'GET', title: 'List all customers' }
// }
```

### Resource with Relations

```typescript
const links = generateLinks(
  'customers',
  'cust-123',
  'https://api.example.com',
  {
    relations: {
      orders: { resource: 'orders', type: 'hasMany' },
      subscription: { resource: 'subscriptions', type: 'hasOne' }
    }
  }
)

// Additional links generated:
// {
//   ...standard links,
//   orders: { href: '.../customers/cust-123/orders', rel: 'related', method: 'GET' },
//   subscription: { href: '.../customers/cust-123/subscription', rel: 'item', method: 'GET' }
// }
```

### Resource with Custom Actions

```typescript
const links = generateLinks(
  'customers',
  'cust-123',
  'https://api.example.com',
  {
    actions: ['upgrade', 'suspend', 'reactivate']
  }
)

// Additional links generated:
// {
//   ...standard links,
//   upgrade: { href: '.../customers/cust-123/upgrade', rel: 'upgrade', method: 'POST' },
//   suspend: { href: '.../customers/cust-123/suspend', rel: 'suspend', method: 'POST' },
//   reactivate: { href: '.../customers/cust-123/reactivate', rel: 'reactivate', method: 'POST' }
// }
```

### Full Resource Configuration

```typescript
import { ResourceConfig } from '@dotdo/api'

const config: ResourceConfig = {
  basePath: '/customers',
  relations: {
    orders: { resource: 'orders', type: 'hasMany' },
    profile: { resource: 'profiles', type: 'hasOne' },
    organization: { resource: 'orgs', type: 'belongsTo' }
  },
  actions: ['verify', 'block', 'unblock']
}

const links = generateLinks('customers', 'cust-123', 'https://api.example.com', config)
```

## Collection Links

### Basic Collection Links

```typescript
import { generateCollectionLinks } from '@dotdo/api'

const links = generateCollectionLinks(
  'customers',
  'https://api.example.com'
)

// {
//   self: { href: '.../customers?page=1&limit=20', rel: 'self', method: 'GET' },
//   create: { href: '.../customers', rel: 'create-form', method: 'POST', title: 'Create customers' }
// }
```

### Paginated Collection

```typescript
const links = generateCollectionLinks(
  'customers',
  'https://api.example.com',
  { page: 3, limit: 25, total: 200 }
)

// {
//   self: { href: '.../customers?page=3&limit=25', rel: 'self' },
//   create: { href: '.../customers', rel: 'create-form', method: 'POST' },
//   first: { href: '.../customers?page=1&limit=25', rel: 'first' },
//   prev: { href: '.../customers?page=2&limit=25', rel: 'prev' },
//   next: { href: '.../customers?page=4&limit=25', rel: 'next' },
//   last: { href: '.../customers?page=8&limit=25', rel: 'last' }
// }
```

### Collection with Items

```typescript
import { withCollectionLinks } from '@dotdo/api'

const customers = [
  { $id: 'cust-1', name: 'Alice', email: 'alice@example.com' },
  { $id: 'cust-2', name: 'Bob', email: 'bob@example.com' },
  { $id: 'cust-3', name: 'Charlie', email: 'charlie@example.com' }
]

const response = withCollectionLinks(
  customers,
  'customers',
  'https://api.example.com',
  (customer) => customer.$id,
  { page: 1, limit: 10, total: 50 }
)

// {
//   data: [
//     {
//       $id: 'cust-1',
//       name: 'Alice',
//       _links: {
//         self: { href: '.../customers/cust-1', ... },
//         update: { href: '.../customers/cust-1', ... },
//         ...
//       }
//     },
//     ...
//   ],
//   _links: {
//     self: { href: '.../customers?page=1&limit=10', ... },
//     create: { href: '.../customers', ... },
//     next: { href: '.../customers?page=2&limit=10', ... },
//     last: { href: '.../customers?page=5&limit=10', ... }
//   }
// }
```

## Error Responses

Error responses also include HATEOAS links for navigation:

### Creating Error Response

```typescript
import { createErrorResponse, generateErrorLinks } from '@dotdo/api'

const error = createErrorResponse(
  'Customer not found',
  404,
  'https://api.example.com',
  {
    requestId: 'req-abc123',
    docsPath: '/docs',
    healthPath: '/health',
    details: { customerId: 'cust-invalid' }
  }
)

// {
//   error: 'Customer not found',
//   status: 404,
//   requestId: 'req-abc123',
//   details: { customerId: 'cust-invalid' },
//   _links: {
//     root: { href: 'https://api.example.com/', rel: 'up', title: 'API Root' },
//     help: { href: 'https://api.example.com/docs', rel: 'help', title: 'API documentation' },
//     health: { href: 'https://api.example.com/health', rel: 'related', title: 'Health check' }
//   }
// }
```

### Error Link Generation

```typescript
const errorLinks = generateErrorLinks('https://api.example.com', {
  docsPath: '/docs',
  healthPath: '/health'
})

// Links help users navigate even after errors
```

## URL Validation and Security

The HATEOAS module includes security features to prevent XSS and injection attacks:

### URL Validation

```typescript
import { isValidUrl, buildSafeUrl } from '@dotdo/api'

// Validates URLs
isValidUrl('https://api.example.com/users')  // true
isValidUrl('/users/123')                      // true (relative)
isValidUrl('javascript:alert(1)')             // false (XSS)
isValidUrl('data:text/html,...')              // false (data URI)

// Safe URL building
const url = buildSafeUrl('https://api.example.com', 'users', 'user-123')
// 'https://api.example.com/users/user-123'

// Handles special characters safely
const url = buildSafeUrl('https://api.example.com', 'users', 'user/with/slashes')
// 'https://api.example.com/users/user%2Fwith%2Fslashes'
```

### Link Validation

```typescript
import { validateLink, validateRequiredLinks, validateAllLinks } from '@dotdo/api'

// Validate single link
try {
  validateLink(link, 'self')
} catch (error) {
  if (error instanceof LinkValidationError) {
    console.log(`Invalid ${error.field}: ${error.value}`)
  }
}

// Validate required links are present
const links = { self: {...}, update: {...} }
validateRequiredLinks(links, ['self', 'collection'])  // throws if missing

// Validate all links and get errors
const errors = validateAllLinks(links)
if (errors.length > 0) {
  console.log('Validation errors:', errors)
}
```

## Integration with Hono

### HATEOAS Middleware

```typescript
import { Hono } from 'hono'
import {
  generateLinks,
  withLinks,
  generateCollectionLinks,
  withCollectionLinks,
  generateAPIRoot
} from '@dotdo/api'

const app = new Hono()

// Middleware to add base URL to context
app.use('*', async (c, next) => {
  c.set('baseUrl', `${c.req.url.split('/').slice(0, 3).join('/')}`)
  await next()
})

// API Root
app.get('/', (c) => {
  const root = generateAPIRoot({
    name: 'My API',
    version: '1.0.0',
    baseUrl: c.get('baseUrl'),
    resources: {
      customers: { path: '/customers' },
      orders: { path: '/orders' }
    }
  })
  return c.json(root)
})

// Collection endpoint
app.get('/customers', async (c) => {
  const customers = await getCustomers()
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const total = await getCustomerCount()

  const response = withCollectionLinks(
    customers,
    'customers',
    c.get('baseUrl'),
    (cust) => cust.$id,
    { page, limit, total }
  )

  return c.json(response)
})

// Single resource endpoint
app.get('/customers/:id', async (c) => {
  const customer = await getCustomer(c.req.param('id'))

  if (!customer) {
    return c.json(
      createErrorResponse('Customer not found', 404, c.get('baseUrl')),
      404
    )
  }

  const links = generateLinks('customers', customer.$id, c.get('baseUrl'), {
    relations: {
      orders: { resource: 'orders', type: 'hasMany' }
    }
  })

  return c.json(withLinks(customer, links))
})
```

### Complete API Example

```typescript
import { Hono } from 'hono'
import { defineResource } from '@dotdo/api'
import {
  generateLinks,
  withLinks,
  withCollectionLinks,
  generateAPIRoot,
  createErrorResponse
} from '@dotdo/api'

// Define resources
const CustomerResource = defineResource('customers')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', required: true }
  })
  .relations({
    orders: { type: 'hasMany', resource: 'orders' }
  })
  .actions({
    upgrade: { method: 'POST', handler: async (c) => ({ upgraded: true }) }
  })
  .build()

const app = new Hono()

// API Root - entry point
app.get('/', (c) => {
  return c.json(generateAPIRoot({
    name: 'E-commerce API',
    version: '1.0.0',
    baseUrl: getBaseUrl(c),
    resources: {
      customers: { path: '/customers', title: 'Manage customers' },
      orders: { path: '/orders', title: 'Manage orders' }
    },
    openapi: { json: '/openapi.json' },
    docsPath: '/docs'
  }))
})

// List customers
app.get('/customers', async (c) => {
  const { page = 1, limit = 20 } = c.req.query()
  const { items, total } = await db.customers.list({ page, limit })

  return c.json(withCollectionLinks(
    items,
    'customers',
    getBaseUrl(c),
    (c) => c.$id,
    { page: Number(page), limit: Number(limit), total }
  ))
})

// Get single customer
app.get('/customers/:id', async (c) => {
  const customer = await db.customers.get(c.req.param('id'))

  if (!customer) {
    return c.json(
      createErrorResponse('Not found', 404, getBaseUrl(c)),
      404
    )
  }

  return c.json(withLinks(
    customer,
    generateLinks('customers', customer.$id, getBaseUrl(c), {
      relations: CustomerResource.relations,
      actions: Object.keys(CustomerResource.actions || {})
    })
  ))
})

// Create customer
app.post('/customers', async (c) => {
  const data = await c.req.json()
  const customer = await db.customers.create(data)

  return c.json(
    withLinks(customer, generateLinks('customers', customer.$id, getBaseUrl(c))),
    201,
    { 'Location': `${getBaseUrl(c)}/customers/${customer.$id}` }
  )
})

// Get customer orders (relation)
app.get('/customers/:id/orders', async (c) => {
  const orders = await db.orders.findByCustomer(c.req.param('id'))

  return c.json(withCollectionLinks(
    orders,
    'orders',
    getBaseUrl(c),
    (o) => o.$id
  ))
})

// Customer upgrade action
app.post('/customers/:id/upgrade', async (c) => {
  const result = await upgradeCustomer(c.req.param('id'))

  return c.json({
    ...result,
    _links: generateLinks('customers', c.req.param('id'), getBaseUrl(c))
  })
})

function getBaseUrl(c: Context): string {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}
```

## Best Practices

### 1. Always Include Self Links

Every response should include a `self` link:

```typescript
// Good
{
  data: { ... },
  _links: {
    self: { href: '...', rel: 'self' },
    // other links
  }
}

// Bad - no self link
{
  data: { ... }
}
```

### 2. Use Standard Relation Types

Prefer RFC 8288 standard relations over custom ones:

```typescript
// Good - standard relations
{
  _links: {
    self: { rel: 'self', ... },
    edit: { rel: 'edit', ... },       // not 'update'
    collection: { rel: 'collection', ... }
  }
}

// Bad - non-standard
{
  _links: {
    current: { rel: 'current', ... },  // use 'self'
    modify: { rel: 'modify', ... }     // use 'edit'
  }
}
```

### 3. Include HTTP Methods

Help clients know which method to use:

```typescript
// Good
{
  _links: {
    self: { href: '...', rel: 'self', method: 'GET' },
    update: { href: '...', rel: 'edit', method: 'PUT' },
    delete: { href: '...', rel: 'delete', method: 'DELETE' }
  }
}
```

### 4. Provide Titles for Clarity

```typescript
{
  _links: {
    upgrade: {
      href: '.../customers/123/upgrade',
      rel: 'upgrade',
      method: 'POST',
      title: 'Upgrade customer to premium plan'  // Helpful for UI
    }
  }
}
```

### 5. Handle Pagination Consistently

```typescript
// Always include pagination links when applicable
{
  data: [...],
  _links: {
    self: { href: '...?page=2&limit=20', rel: 'self' },
    first: { href: '...?page=1&limit=20', rel: 'first' },
    prev: { href: '...?page=1&limit=20', rel: 'prev' },
    next: { href: '...?page=3&limit=20', rel: 'next' },
    last: { href: '...?page=10&limit=20', rel: 'last' }
  },
  meta: {
    page: 2,
    limit: 20,
    total: 200,
    totalPages: 10
  }
}
```

### 6. Validate URLs for Security

```typescript
import { isValidUrl, buildSafeUrl } from '@dotdo/api'

// Always validate user-provided URLs
if (!isValidUrl(userUrl)) {
  throw new Error('Invalid URL')
}

// Use buildSafeUrl for dynamic paths
const url = buildSafeUrl(baseUrl, userProvidedPath)
```

## File Locations

| File | Description |
|------|-------------|
| `/Users/nathanclevenger/projects/dotdo/api/hateoas.ts` | HATEOAS implementation |
| `/Users/nathanclevenger/projects/dotdo/api/resource.ts` | Resource definition DSL |
| `/Users/nathanclevenger/projects/dotdo/api/tests/hateoas.test.ts` | HATEOAS tests |
| `/Users/nathanclevenger/projects/dotdo/api/tests/hateoas-e2e.test.ts` | E2E tests |

## Related Documentation

- [SDK Generation](./SDK_GENERATION.md) - TypeScript SDK generation
- [MCP Tools](./MCP_TOOLS.md) - AI agent tool generation
- [AI Module](./AI_MODULE.md) - AI routing and template literals
- [Error Handling](./ERROR_HANDLING.md) - Error response patterns
