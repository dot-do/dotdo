# Hono API Shape Design

> Status: Draft - some aspects marked for iteration

## Overview

Design for the default Hono API shape across DO, proxy workers, and app workers. Core principle: **every URL is clickable** - for humans in browsers and AI agents navigating programmatically.

## Core Response Shape

Every response includes three clickable URLs:

```json
{
  "$context": "https://headless.ly",
  "$type": "https://headless.ly/customers",
  "$id": "https://headless.ly/customers/123",
  "name": "Acme Corp"
}
```

| Field | Purpose | Clicks to |
|-------|---------|-----------|
| `$context` | Navigate up | Parent namespace or schema |
| `$type` | Collection/schema | List of all items of this type |
| `$id` | This resource | The canonical URL for this item |

### $context Navigation

`$context` always points "up one level":

- **Item** → namespace (DO root)
- **Collection** → namespace (DO root)
- **DO root** → parent DO
- **Top-level DO** → `https://schema.org.ai/DO`

Example chain:
```
https://headless.ly/customers/123
  ↑ $context
https://headless.ly
  ↑ $context
https://Startups.Studio
  ↑ $context
https://schema.org.ai/Collection
  ↑ $context
https://schema.org.ai/DO
```

## Two DO Types

### DO (multi-collection)

Has multiple collections at `/:type/:id`:

```
https://crm.example.org.ai/acme           → root index
https://crm.example.org.ai/acme/contacts  → Contact collection
https://crm.example.org.ai/acme/contacts/john → Contact item
```

Root response:
```json
{
  "$context": "https://crm.example.org.ai",
  "$type": "https://crm.example.org.ai/acme",
  "$id": "https://crm.example.org.ai/acme",
  "name": "Acme Corp CRM",
  "contacts": { "$id": "https://crm.example.org.ai/acme/contacts", "count": 42 },
  "companies": { "$id": "https://crm.example.org.ai/acme/companies", "count": 15 },
  "deals": { "$id": "https://crm.example.org.ai/acme/deals", "count": 8 }
}
```

### Collection\<T\> (single-collection)

Is the collection at `/:id`:

```
https://Startups.Studio                   → root IS the collection
https://Startups.Studio/headless.ly       → Startup item
```

Root response:
```json
{
  "$context": "https://schema.org.ai/Collection",
  "$type": "https://Startups.Studio",
  "$id": "https://Startups.Studio",
  "count": 42,
  "items": [...]
}
```

## Namespace Identity

The namespace (`this.ns`) is the hostname + optional base path:

```typescript
// Request: GET https://api.example.org.ai/acme/customers/123
const ns = origin + basePath  // "https://api.example.org.ai/acme"
const id = DO.idFromName(ns)  // unique DO per namespace
```

Nesting can be through subdomains and/or paths:
- `https://acme.example.org.ai` (subdomain)
- `https://example.org.ai/acme` (path)
- `https://acme.crm.example.org.ai/west` (both)

## Promotion/Demotion

Things can be promoted to their own DO:

**Before (Thing in Collection):**
```json
{
  "$context": "https://Startups.Studio",
  "$type": "https://Startups.Studio",
  "$id": "https://Startups.Studio/headless.ly",
  "name": "Headless.ly"
}
```

**After (own DO):**
```json
{
  "$context": "https://Startups.Studio",
  "$type": "https://headless.ly",
  "$id": "https://headless.ly",
  "name": "Headless.ly",
  "customers": { "$id": "https://headless.ly/customers", "count": 100 }
}
```

Note: At root `/`, `$context` is the parent. On other paths, `$context` is the namespace.

## Collection Response

```json
{
  "$context": "https://headless.ly",
  "$type": "https://headless.ly/customers",
  "$id": "https://headless.ly/customers",

  "count": 1847,

  "links": {
    "home": "https://headless.ly",
    "first": "https://headless.ly/customers",
    "prev": "https://headless.ly/customers?before=abc",
    "next": "https://headless.ly/customers?after=xyz",
    "last": "https://headless.ly/customers?last=true"
  },

  "facets": {
    "sort": ["name", "createdAt", "-createdAt", "revenue"],
    "filter": {
      "status": ["lead", "prospect", "customer", "churned"],
      "region": ["US", "EU", "APAC"]
    }
  },

  "actions": {
    "create": "https://headless.ly/customers",
    "export": "https://headless.ly/customers/export"
  },

  "items": [
    { "$context": "...", "$type": "...", "$id": "...", "name": "Acme" }
  ]
}
```

## Item Response

```json
{
  "$context": "https://headless.ly",
  "$type": "https://headless.ly/customers",
  "$id": "https://headless.ly/customers/123",
  "name": "Acme Corp",

  "links": {
    "collection": "https://headless.ly/customers",
    "edit": "https://headless.ly/customers/123/edit",
    "orders": "https://headless.ly/customers/123/orders"
  },

  "actions": {
    "update": "https://headless.ly/customers/123",
    "delete": "https://headless.ly/customers/123",
    "promote": "https://headless.ly/customers/123/promote"
  }
}
```

### Links vs Actions

- **`links`** = navigation (GET requests, views)
- **`actions`** = mutations (POST/PUT/DELETE)

## Built-in Edit UI

Every DO includes a Monaco-based edit view:

```
GET  /customers/123       → JSON (view)
GET  /customers/123/edit  → HTML with Monaco editor
PUT  /customers/123       → Update (save from editor)
```

The `/edit` endpoint returns a simple HTML page with embedded Monaco that PUTs on save.

## Relationships and References

> TBD: Exact shape needs iteration

**Option 1: Top-level verbs**
```json
{
  "$id": "https://headless.ly/contacts/john",
  "worksAt": "https://headless.ly/companies/acme",
  "manages": [
    "https://headless.ly/contacts/bob",
    "https://headless.ly/contacts/alice"
  ]
}
```

**Option 2: Grouped**
```json
{
  "$id": "https://headless.ly/contacts/john",
  "relationships": {
    "worksAt": "https://headless.ly/companies/acme"
  },
  "references": {
    "managedBy": "https://headless.ly/contacts/jane"
  }
}
```

Single value → string, multiple values → array.

## Architecture Layers

### 1. DO (canonical)

- Serves REST at `/:type/:id` (multi-collection) or `/:id` (single-collection)
- Serves RPC at `/rpc`
- Always returns full linked shape with `$context`/`$type`/`$id`
- Includes built-in `/edit` UI
- Simple, opinionated, consistent

### 2. Simple Proxy Worker

```typescript
import { API } from 'dotdo'

// Hostname mode - subdomain → DO
export default API()  // tenant.api.example.org.ai → DO('tenant')

// Path mode - param → DO
export default API({ ns: '/:org' })  // api.example.org.ai/acme → DO('acme')

// Nested - colon-separated
export default API({ ns: '/:org/:project' })  // → DO('acme:proj1')
```

Just forwards requests to DO based on namespace extraction.

### 3. App Worker (sophisticated)

```typescript
const app = new Hono()

// /api, /admin, /app are presentation views
// Worker uses RPC, not REST forwarding

app.get('/api/customers/:id', async (c) => {
  const customer = await stub.Customer(id)  // RPC call
  return c.json(customer)
})

app.get('/admin/customers/:id', async (c) => {
  const customer = await stub.Customer(id)
  return c.html(renderAdminView(customer))
})
```

Features:
- Own routing logic
- Sharding support
- Geo-replica awareness
- Response transformation (JSON-LD, JSON API, HAL, raw)
- Caching layers
- Auth/sessions

### Canonical Path

The DO serves at `/:type/:id`. Workers add prefixes (`/api`, `/admin`, `/app`) that get stripped before forwarding or are used for different presentation.

The `$id` is always the canonical path without prefixes:
```json
{
  "$id": "https://headless.ly/customers/123"
}
```

Not `/api/customers/123`.

## HTTP Endpoints per Resource

```
GET  /:type              → List (collection)
POST /:type              → Create
GET  /:type/:id          → Get item
PUT  /:type/:id          → Replace
PATCH /:type/:id         → Update
DELETE /:type/:id        → Delete
GET  /:type/:id/edit     → Edit UI
GET  /:type/:id/:rel     → Related collection
POST /:type/:id/:action  → Custom action
```

## Open Questions

1. **Facets shape** - exact structure for sort/filter options
2. **Relationships grouping** - top-level verbs vs grouped under `relationships`/`references`
3. **Action HTTP methods** - convention by verb name or all POST
4. **Error response shape** - TBD

## Examples

### CRM Multi-tenant

```
https://crm.example.org.ai              → CRM app (org registry)
https://crm.example.org.ai/acme         → Acme's tenant DO
https://crm.example.org.ai/acme/contacts/john → Contact in Acme
```

### Startups Collection

```
https://Startups.Studio                 → Collection<Startup>
https://Startups.Studio/headless.ly     → Startup item
```

After promotion:
```
https://headless.ly                     → Startup's own DO
https://headless.ly/customers           → Startup's customers
https://headless.ly/customers/acme      → Customer item
```
