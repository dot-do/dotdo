[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createVectorContext

# Function: createVectorContext()

> **createVectorContext**(): [`VectorContext`](../interfaces/VectorContext.md)

Defined in: workflows/context/vector.ts:223

Creates a mock workflow context ($) with vector support for testing

This factory creates a context object with:
- $.vector(config?) - Returns a VectorContextInstance
- $._storage - Internal storage for test setup
- $._setBindings - Set bindings for the manager

## Returns

[`VectorContext`](../interfaces/VectorContext.md)

A VectorContext object with vector API methods

## Example

```typescript
const $ = createMockContext()

// Configure vector search
const vec = $.vector({
  tiers: {
    hot: { engine: 'libsql', dimensions: 1536 },
    warm: { engine: 'vectorize', dimensions: 1536 }
  },
  routing: { strategy: 'cascade', fallback: true }
})

// Insert vectors
await vec.insert('doc-1', embeddings, { title: 'My Doc' })

// Search for similar
const results = await vec.search(queryEmbedding, {
  limit: 10,
  threshold: 0.7
})
```
