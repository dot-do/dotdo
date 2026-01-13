# couchdb.do

**CouchDB for Cloudflare Workers.** MapReduce on the edge. Sandboxed. Scales infinitely.

[![npm version](https://img.shields.io/npm/v/@dotdo/couchdb.svg)](https://www.npmjs.com/package/@dotdo/couchdb)
[![Tests](https://img.shields.io/badge/tests-47%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why couchdb.do?

**CouchDB views are powerful.** MapReduce lets you build any index. Compound keys. Multiple emits. Real-time filtering.

**But CouchDB doesn't run on the edge.** No Cloudflare Workers support. No Durable Objects integration. No serverless scale.

**couchdb.do gives you both:**

```typescript
import { parseMapFunction, executeMapFunction } from '@dotdo/couchdb'

// Real CouchDB map functions - on the edge
const fn = parseMapFunction(`function(doc) {
  if (doc.type === 'post') {
    emit([doc.author, doc.createdAt], doc.title);
  }
}`)

const results = fn({ _id: 'post-1', type: 'post', author: 'alice', createdAt: '2024-01-15', title: 'Hello World' })
// [{ key: ['alice', '2024-01-15'], value: 'Hello World' }]
```

**Scales to millions of agents.** Each agent gets its own isolated view engine on Cloudflare's edge network. No shared state. No noisy neighbors. Just fast, sandboxed MapReduce at global scale.

## Installation

```bash
npm install @dotdo/couchdb
```

## Quick Start

```typescript
import { parseMapFunction, executeMapFunction } from '@dotdo/couchdb'

// Parse once, execute many times
const mapFn = parseMapFunction(`function(doc) {
  emit(doc.type, doc);
}`)

// Execute against documents
const doc1 = { _id: '1', type: 'user', name: 'Alice' }
const doc2 = { _id: '2', type: 'post', title: 'Hello' }

mapFn(doc1)  // [{ key: 'user', value: { _id: '1', type: 'user', name: 'Alice' } }]
mapFn(doc2)  // [{ key: 'post', value: { _id: '2', type: 'post', title: 'Hello' } }]

// Or parse + execute in one call
const results = executeMapFunction(
  `function(doc) { emit(doc._id, doc.name); }`,
  { _id: 'user-1', name: 'Alice' }
)
```

## Features

### Full CouchDB Map Function Syntax

Every pattern CouchDB supports. You don't think about compatibility.

```typescript
// Simple emit
`function(doc) { emit(doc._id, doc); }`

// Conditional emit (filtering)
`function(doc) {
  if (doc.type === 'post') {
    emit(doc._id, doc);
  }
}`

// Multiple emits per document
`function(doc) {
  for (var i = 0; i < doc.tags.length; i++) {
    emit(doc.tags[i], doc._id);
  }
}`

// Compound keys (arrays)
`function(doc) {
  emit([doc.year, doc.month, doc.day], doc);
}`

// Computed values
`function(doc) {
  emit(doc.email.toLowerCase(), doc.name);
}`

// Arrow function syntax
`(doc) => { emit(doc._id, doc.name); }`
`doc => emit(doc._id, doc.name)`
```

### Sandboxed Execution

Map functions run in a secure sandbox. Safe built-ins only. You don't think about security.

```
┌─────────────────────────────────────────────────────────────┐
│                    Allowed (Safe)                           │
├─────────────────────────────────────────────────────────────┤
│  JSON, Object, Array, String, Number, Boolean               │
│  Math, Date, RegExp, Error                                  │
│  parseInt, parseFloat, isNaN, isFinite                      │
│  encodeURI, decodeURI, encodeURIComponent, decodeURIComponent│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Blocked (Dangerous)                      │
├─────────────────────────────────────────────────────────────┤
│  process, require, module, exports, global, Buffer          │
│  fetch, XMLHttpRequest, WebSocket                           │
│  eval, Function                                             │
│  setTimeout, setInterval, setImmediate                      │
│  globalThis, window, self, document                         │
│  Worker, importScripts                                      │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// Sandbox blocks dangerous access
const mapFn = `function(doc) {
  emit(doc._id, typeof process);  // → 'undefined'
}`

const mapFn2 = `function(doc) {
  emit(doc._id, typeof fetch);    // → 'undefined'
}`

// Safe built-ins work
const mapFn3 = `function(doc) {
  var d = new Date(doc.createdAt);
  emit([d.getFullYear(), d.getMonth() + 1], doc);
}`
```

### Function Caching

Parsed functions are cached. Parse once, execute millions of times.

```typescript
import { parseMapFunction, getMapFunctionCacheSize, clearMapFunctionCache } from '@dotdo/couchdb'

// First call parses and caches
const fn1 = parseMapFunction(`function(doc) { emit(doc._id, 1); }`)

// Second call returns cached version
const fn2 = parseMapFunction(`function(doc) { emit(doc._id, 1); }`)

fn1 === fn2  // true - same cached function

// LRU cache with 1000 entry limit
getMapFunctionCacheSize()  // Current cache size
clearMapFunctionCache()    // Manual cleanup (rarely needed)
```

### Graceful Error Handling

Map function errors don't crash. They log and return empty results. Just like CouchDB.

```typescript
const mapFn = parseMapFunction(`function(doc) {
  emit(doc.nested.deep.value, 1);  // Throws if path doesn't exist
}`)

// Missing fields don't crash
mapFn({ _id: '1' })  // [] - empty results, error logged

// Use defensive checks for safety
const safeFn = parseMapFunction(`function(doc) {
  if (doc.nested && doc.nested.deep) {
    emit(doc.nested.deep.value, 1);
  }
}`)
```

## Real-World Patterns

### Index by Type

```typescript
const byType = parseMapFunction(`function(doc) {
  if (doc.type) {
    emit([doc.type, doc.createdAt], doc);
  }
}`)

// Query: startkey=['post'], endkey=['post', {}]
```

### Secondary Index by Email

```typescript
const byEmail = parseMapFunction(`function(doc) {
  if (doc.type === 'user' && doc.email) {
    emit(doc.email.toLowerCase(), { _id: doc._id, name: doc.name });
  }
}`)
```

### Count Pattern (for Reduce)

```typescript
const orderCounts = parseMapFunction(`function(doc) {
  if (doc.type === 'order') {
    emit(doc.status, 1);
  }
}`)

// Combine with _sum reduce for totals
```

### Linked Documents

```typescript
const linked = parseMapFunction(`function(doc) {
  if (doc.type === 'comment') {
    emit([doc.postId, 0], { _id: doc.postId });
    emit([doc.postId, 1], doc);
  } else if (doc.type === 'post') {
    emit([doc._id, 0], doc);
  }
}`)

// Returns post followed by its comments, in order
```

### Tag Indexing

```typescript
const byTag = parseMapFunction(`function(doc) {
  if (doc.tags && doc.tags.length) {
    for (var i = 0; i < doc.tags.length; i++) {
      emit(doc.tags[i], doc._id);
    }
  }
}`)

// Query: key='javascript' returns all docs with that tag
```

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `parseMapFunction(source)` | Parse map function string, return cached executor |
| `executeMapFunction(source, doc)` | Parse and execute in one call |
| `clearMapFunctionCache()` | Clear the function cache |
| `getMapFunctionCacheSize()` | Get current cache size |

### Types

```typescript
interface EmitResult {
  key: unknown
  value: unknown
}

type ParsedMapFunction = (doc: Record<string, unknown>) => EmitResult[]
```

### parseMapFunction

```typescript
import { parseMapFunction } from '@dotdo/couchdb'

// Parse a map function string
const fn = parseMapFunction(`function(doc) { emit(doc._id, doc); }`)

// Execute against documents
const results = fn({ _id: '1', name: 'Alice' })
// [{ key: '1', value: { _id: '1', name: 'Alice' } }]
```

### executeMapFunction

```typescript
import { executeMapFunction } from '@dotdo/couchdb'

// Parse and execute in one call
// (Use parseMapFunction for better performance with many docs)
const results = executeMapFunction(
  `function(doc) { emit(doc.type, doc._id); }`,
  { _id: '1', type: 'user' }
)
// [{ key: 'user', value: '1' }]
```

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { parseMapFunction } from '@dotdo/couchdb'

class MyDatabase extends DO {
  private views = new Map<string, ParsedMapFunction>()

  async createView(name: string, mapFn: string) {
    this.views.set(name, parseMapFunction(mapFn))
  }

  async query(viewName: string) {
    const mapFn = this.views.get(viewName)
    const docs = await this.$.sql`SELECT * FROM documents`

    return docs.flatMap(doc => mapFn(doc))
  }
}
```

### Design Document Pattern

```typescript
interface DesignDocument {
  _id: string
  views: {
    [name: string]: {
      map: string
      reduce?: string
    }
  }
}

// Store design docs in SQLite
// Parse map functions on first use
// Cache for subsequent queries
```

## How It Works

```
Input: "function(doc) { if (doc.type === 'post') emit(doc._id, doc); }"
         ↓
┌─────────────────────────────────────┐
│         Cache Check                 │
│    Return cached if exists          │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│         Source Normalization        │
│    function() → var param = doc     │
│    arrow => → var param = doc       │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│         Sandbox Construction        │
│    Inject safe globals              │
│    Block dangerous globals          │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│         Function Compilation        │
│    new Function(...sandbox, body)   │
│    Syntax validation                │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│         Cache & Return              │
│    LRU cache (1000 entries)         │
└─────────────────────────────────────┘
         ↓
Output: Executor function (doc) => EmitResult[]
```

## Comparison

| Feature | CouchDB | couchdb.do |
|---------|---------|------------|
| Map functions | Yes | Yes |
| Reduce functions | Yes | Coming soon |
| Edge-native | No | Yes |
| Durable Objects | No | Yes |
| Sandboxed | Yes | Yes |
| Function caching | No | Yes (LRU) |
| Arrow functions | No | Yes |
| Zero cold starts | No | Yes |

## Performance

- **47 tests** covering all map function patterns
- **LRU caching** with 1000 function limit
- **Parse once** execute millions of times
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://couchdb.do)
- [CouchDB Views Guide](https://docs.couchdb.org/en/stable/ddocs/views/intro.html)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
