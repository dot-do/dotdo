# Algolia Search Compat

**Algolia search. Self-hosted. Instant.**

```typescript
import { algoliasearch } from '@dotdo/algolia'

const client = algoliasearch('myapp', 'api-key')
const products = client.initIndex('products')

// Index your catalog
await products.saveObjects([
  { objectID: 'iphone-15', name: 'iPhone 15', category: 'Phones', brand: 'Apple', price: 999 },
  { objectID: 'pixel-8', name: 'Pixel 8', category: 'Phones', brand: 'Google', price: 699 },
  { objectID: 'macbook-pro', name: 'MacBook Pro', category: 'Laptops', brand: 'Apple', price: 2499 },
])

// Search with typo tolerance
const { hits } = await products.search('iphoone')  // finds "iPhone 15"

// Faceted navigation
const results = await products.search('', {
  facets: ['category', 'brand'],
  filters: 'price < 1000'
})
// results.facets = { category: { Phones: 2 }, brand: { Apple: 1, Google: 1 } }
```

**Typo tolerance. Highlighting. Zero API costs.**

---

## Features

| Feature | Description |
|---------|-------------|
| Full-text search | FTS5-backed instant search |
| Typo tolerance | Built-in fuzzy matching |
| Faceted navigation | Category, brand, price filtering |
| Highlighting | Query term highlighting in results |
| Synonyms | Configure search aliases |
| Prefix search | As-you-type suggestions |
| Pagination | Cursor-based browsing |

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
```

## Usage Examples

### Index Products

```typescript
// Single object
await index.saveObject({
  objectID: 'prod-1',
  name: 'Wireless Headphones',
  category: 'Audio',
  brand: 'Sony',
  price: 299,
  inStock: true
})

// Bulk indexing
await index.saveObjects(products, {
  autoGenerateObjectIDIfNotExist: true
})
```

### Search with Options

```typescript
// Basic search
const { hits, nbHits } = await index.search('headphones')

// With filters
const results = await index.search('sony', {
  filters: 'category:Audio AND price < 500',
  hitsPerPage: 20,
  page: 0
})

// Faceted search
const faceted = await index.search('', {
  facets: ['category', 'brand', 'price'],
  facetFilters: ['category:Audio']
})
```

### Highlighting

```typescript
await index.setSettings({
  attributesToHighlight: ['name', 'description'],
  highlightPreTag: '<mark>',
  highlightPostTag: '</mark>'
})

const { hits } = await index.search('wireless')
// hits[0]._highlightResult.name.value = '<mark>Wireless</mark> Headphones'
```

### Synonyms

```typescript
await index.setSettings({
  synonyms: [
    { synonyms: ['headphones', 'earphones', 'earbuds'] },
    { synonyms: ['tv', 'television', 'smart tv'] }
  ]
})
```

### Browse All Objects

```typescript
// Iterate through entire index
await index.browseObjects({
  batch: (hits) => {
    for (const hit of hits) {
      console.log(hit.objectID, hit.name)
    }
  }
})
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /index` | Index products |
| `GET /search?q=query` | Search products |
| `GET /search?q=query&facets=category,brand` | Search with facets |
| `GET /products/:id` | Get single product |
| `DELETE /products/:id` | Remove product |
| `POST /settings` | Update index settings |

## Index Settings

```typescript
await index.setSettings({
  // Which fields to search
  searchableAttributes: ['name', 'description', 'brand'],

  // Which fields can be filtered/faceted
  attributesForFaceting: ['category', 'brand', 'filterOnly(price)'],

  // Pagination defaults
  hitsPerPage: 20,

  // Highlighting
  attributesToHighlight: ['name', 'description'],
  highlightPreTag: '<em>',
  highlightPostTag: '</em>'
})
```

## Architecture

```
SearchDO (Durable Object)
├── SQLite FTS5 index
├── In-memory facet cache
└── Settings storage

Client Request
    ↓
Worker (API routing)
    ↓
SearchDO.search(query, options)
    ↓
FTS5 query + filter + facet aggregation
    ↓
JSON response with hits, facets, highlighting
```

---

Built with [dotdo](https://dotdo.dev) | Compatible with [Algolia JavaScript SDK](https://www.algolia.com/doc/api-client/getting-started/install/javascript/)
