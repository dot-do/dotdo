# @dotdo/algolia

**Algolia for Cloudflare Workers.** Edge-native search. FTS5-powered. Zero dependencies.

[![npm version](https://img.shields.io/npm/v/@dotdo/algolia.svg)](https://www.npmjs.com/package/@dotdo/algolia)
[![Tests](https://img.shields.io/badge/tests-74%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why @dotdo/algolia?

**Edge workers can't run Algolia.** The official SDK expects HTTP connections to Algolia's servers with API keys that shouldn't be exposed in client-side code.

**AI agents need search.** They need full-text search, faceting, filtering, and instant results without network latency.

**@dotdo/algolia gives you both:**

```typescript
import algoliasearch from '@dotdo/algolia'

// Drop-in replacement - same API, runs on the edge
const client = algoliasearch('APP_ID', 'API_KEY')
const index = client.initIndex('products')

// Save objects
await index.saveObject({ objectID: '1', name: 'iPhone 15', price: 999 })

// Search with full Algolia syntax
const { hits, facets } = await index.search('iPhone', {
  filters: 'price < 1200 AND inStock:true',
  facets: ['brand', 'category'],
})
```

**Scales to millions of agents.** Each agent gets its own isolated search index on Cloudflare's edge network. No shared state. No noisy neighbors. Just fast, persistent full-text search at global scale.

## Installation

```bash
npm install @dotdo/algolia
```

## Quick Start

```typescript
import algoliasearch from '@dotdo/algolia'

const client = algoliasearch('APP_ID', 'API_KEY')
const index = client.initIndex('products')

// Index objects
await index.saveObjects([
  { objectID: '1', name: 'iPhone 15 Pro', brand: 'Apple', price: 1199 },
  { objectID: '2', name: 'Galaxy S24', brand: 'Samsung', price: 899 },
  { objectID: '3', name: 'MacBook Pro', brand: 'Apple', price: 2499 },
])

// Search
const { hits } = await index.search('iPhone')
// [{ objectID: '1', name: 'iPhone 15 Pro', ... }]

// Filter
const results = await index.search('', {
  filters: 'brand:Apple AND price < 2000',
})

// Facets
const faceted = await index.search('', {
  facets: ['brand', 'category'],
})
// facets: { brand: { Apple: 2, Samsung: 1 }, ... }
```

## Features

### Full Search API

Complete Algolia search API with query, filters, and facets.

```typescript
// Text search with scoring
const { hits } = await index.search('macbook pro')

// Boolean filters
const results = await index.search('', {
  filters: 'brand:Apple AND (category:phones OR category:tablets)',
})

// Numeric filters
const priced = await index.search('', {
  filters: 'price >= 500 AND price <= 1000',
})

// Facet filters (AND of ORs)
const filtered = await index.search('', {
  facetFilters: [
    ['brand:Apple', 'brand:Samsung'],  // OR within array
    'inStock:true',                     // AND with other filters
  ],
})

// Numeric filters
const ranged = await index.search('', {
  numericFilters: ['price>=100', 'price<=500'],
})

// Tag filters
const tagged = await index.search('', {
  tagFilters: ['mobile', ['premium', 'budget']],  // mobile AND (premium OR budget)
})
```

### Faceting

Automatic facet counting and facet search.

```typescript
// Configure faceting
await index.setSettings({
  attributesForFaceting: ['brand', 'category', 'price'],
})

// Get facet counts
const { facets } = await index.search('', {
  facets: ['brand', 'category'],
})
// { brand: { Apple: 3, Samsung: 1 }, category: { phones: 2, laptops: 1 } }

// Search for facet values
const facetHits = await index.searchForFacetValues('brand', 'Sam')
// [{ value: 'Samsung', count: 1, highlighted: '<em>Sam</em>sung' }]
```

### Object Management

Full CRUD operations on search records.

```typescript
// Save single object
await index.saveObject({ objectID: '1', name: 'Product', price: 99 })

// Save multiple objects
await index.saveObjects([
  { objectID: '1', name: 'iPhone', price: 999 },
  { objectID: '2', name: 'MacBook', price: 2499 },
])

// Auto-generate objectID
await index.saveObjects(
  [{ name: 'iPad', price: 799 }],
  { autoGenerateObjectIDIfNotExist: true }
)

// Get objects
const obj = await index.getObject('1')
const { results } = await index.getObjects(['1', '2', '3'])

// Partial updates
await index.partialUpdateObject({
  objectID: '1',
  price: 899,  // Only update price
})

// Delete
await index.deleteObject('1')
await index.deleteObjects(['2', '3'])
await index.deleteBy({ filters: 'brand:discontinued' })

// Clear all
await index.clearObjects()
```

### Pagination & Browse

Efficient pagination for large result sets.

```typescript
// Paginated search
const page1 = await index.search('', { page: 0, hitsPerPage: 20 })
const page2 = await index.search('', { page: 1, hitsPerPage: 20 })

// Browse all objects
const browse = await index.browse({ hitsPerPage: 1000 })
// Use cursor for next page

// Iterate through all objects
await index.browseObjects({
  hitsPerPage: 100,
  batch: (hits) => {
    console.log(`Processing ${hits.length} objects`)
  },
})
```

### Highlighting

Automatic query term highlighting in results.

```typescript
await index.setSettings({
  attributesToHighlight: ['name', 'description'],
})

const { hits } = await index.search('iPhone')
// hits[0]._highlightResult.name = {
//   value: '<em>iPhone</em> 15 Pro',
//   matchLevel: 'full',
//   matchedWords: ['iphone']
// }

// Custom highlight tags
const results = await index.search('iPhone', {
  highlightPreTag: '<mark>',
  highlightPostTag: '</mark>',
})
```

### Index Management

Create, copy, move, and delete indices.

```typescript
// List all indices
const { items } = await client.listIndices()

// Copy index (with settings)
await client.copyIndex('products', 'products_backup')

// Move/rename index
await client.moveIndex('products_temp', 'products')

// Delete index
await index.delete()

// Check existence
const exists = await index.exists()
```

### Multi-Index Search

Search across multiple indices in one call.

```typescript
const { results } = await client.multipleQueries([
  { indexName: 'products', query: 'iPhone' },
  { indexName: 'users', query: 'john' },
])

// Get objects from multiple indices
const { results } = await client.multipleGetObjects([
  { indexName: 'products', objectID: '1' },
  { indexName: 'users', objectID: 'user-123' },
])
```

### Settings

Configure search behavior, ranking, and display.

```typescript
await index.setSettings({
  // Searchable attributes (order matters for ranking)
  searchableAttributes: ['name', 'description', 'brand'],

  // Faceting configuration
  attributesForFaceting: ['brand', 'category', 'filterOnly(price)'],

  // Attributes to retrieve
  attributesToRetrieve: ['name', 'price', 'image'],

  // Highlighting
  attributesToHighlight: ['name', 'description'],
  highlightPreTag: '<em>',
  highlightPostTag: '</em>',

  // Pagination
  hitsPerPage: 20,
})

const settings = await index.getSettings()
```

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withSearch } from '@dotdo/algolia/do'

class MyApp extends withSearch(DO) {
  async search(query: string) {
    return this.$.algolia
      .initIndex('products')
      .search(query, { filters: 'inStock:true' })
  }
}
```

### Extended Configuration

Shard routing for multi-tenant search.

```typescript
const client = algoliasearch('APP_ID', 'API_KEY', {
  // Bind to DO namespace for persistence
  doNamespace: env.ALGOLIA_DO,
})
```

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│                      @dotdo/algolia                       │
├──────────────────────────────────────────────────────────┤
│  Algolia Client API (initIndex, search, browse, etc.)    │
├───────────────────────────────┬──────────────────────────┤
│  Search Index                 │  Filter Parser           │
│  - saveObject/saveObjects     │  - Boolean (AND/OR)      │
│  - search/browse              │  - Numeric (<, >, =)     │
│  - getObject/getObjects       │  - Facet filters         │
│  - partialUpdate              │  - Tag filters           │
│  - delete/clear               │  - Negation (NOT)        │
├───────────────────────────────┼──────────────────────────┤
│  FTS Engine                   │  Facet Engine            │
│  - Tokenization               │  - Value counting        │
│  - Scoring                    │  - Facet search          │
│  - Highlighting               │  - Array support         │
├───────────────────────────────┴──────────────────────────┤
│              In-Memory Storage / DO SQLite                │
└──────────────────────────────────────────────────────────┘
```

**Edge Layer (Algolia API)**
- Drop-in replacement for algoliasearch
- Full type safety with generics
- No external dependencies

**Storage Layer (In-Memory / DO SQLite)**
- Microsecond access latency
- FTS5-powered full-text search
- Automatic facet indexing

## API Reference

### Client Methods

| Method | Description |
|--------|-------------|
| `initIndex(name)` | Get index by name |
| `listIndices()` | List all indices |
| `copyIndex(src, dest)` | Copy index |
| `moveIndex(src, dest)` | Move/rename index |
| `multipleQueries(queries)` | Multi-index search |
| `multipleGetObjects(requests)` | Get from multiple indices |

### Index Methods

| Method | Description |
|--------|-------------|
| `search(query, options?)` | Full-text search |
| `searchForFacetValues(facet, query)` | Search facet values |
| `browse(options?)` | Browse all records |
| `browseObjects(options)` | Iterate all records |
| `saveObject(object)` | Save single object |
| `saveObjects(objects)` | Save multiple objects |
| `getObject(id)` | Get by objectID |
| `getObjects(ids)` | Get multiple by IDs |
| `partialUpdateObject(object)` | Partial update |
| `partialUpdateObjects(objects)` | Batch partial update |
| `deleteObject(id)` | Delete by objectID |
| `deleteObjects(ids)` | Delete multiple |
| `deleteBy(options)` | Delete by filter |
| `clearObjects()` | Clear all objects |
| `setSettings(settings)` | Update settings |
| `getSettings()` | Get current settings |
| `exists()` | Check if index exists |
| `delete()` | Delete index |

### Search Options

| Option | Description |
|--------|-------------|
| `query` | Search query text |
| `filters` | Filter expression (e.g., `brand:Apple AND price<1000`) |
| `facetFilters` | Array-based facet filters |
| `numericFilters` | Numeric range filters |
| `tagFilters` | Tag-based filters |
| `facets` | Facets to compute |
| `attributesToRetrieve` | Attributes to return |
| `attributesToHighlight` | Attributes to highlight |
| `highlightPreTag` | Highlight start tag |
| `highlightPostTag` | Highlight end tag |
| `page` | Page number (0-indexed) |
| `hitsPerPage` | Results per page |

## Comparison

| Feature | @dotdo/algolia | algoliasearch | Raw SQLite |
|---------|---------------|---------------|------------|
| Edge Runtime | Yes | No | Yes |
| Full-Text Search | Yes | Yes | Manual |
| Faceting | Yes | Yes | Manual |
| Highlighting | Yes | Yes | Manual |
| Filter Syntax | Yes | Yes | Manual |
| Zero Dependencies | Yes | No | Yes |
| DO Integration | Yes | No | No |
| Multi-Tenant | Yes | Account-based | Manual |

## Performance

- **74 tests** covering all operations
- **Microsecond latency** for DO SQLite operations
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)
- **FTS5-powered** full-text search

## License

MIT

## Related

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://algolia.do)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
