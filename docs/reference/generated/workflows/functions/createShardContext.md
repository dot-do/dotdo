[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createShardContext

# Function: createShardContext()

> **createShardContext**(): [`ShardContext`](../interfaces/ShardContext.md)

Defined in: workflows/context/shard.ts:240

Creates a mock workflow context ($) with shard support for testing

This factory creates a context object with:
- $.shard(namespace, config?) - Returns a ShardContextInstance for the namespace
- $._storage - Internal storage for test setup
- $._registerMockNamespace - Register mock DO namespace for testing

## Returns

[`ShardContext`](../interfaces/ShardContext.md)

A ShardContext object with shard API methods

## Example

```typescript
const $ = createMockContext()

// Configure a shard namespace
const tenantShard = $.shard('tenants', {
  key: 'tenant_id',
  count: 16,
  algorithm: 'consistent'
})

// Get shard for a specific tenant
const shardId = tenantShard.getShardId('tenant-123')
const stub = await tenantShard.getShardStub('tenant-123')

// Fan out query to all shards
const results = await tenantShard.queryAll('/query', {
  method: 'POST',
  body: JSON.stringify({ sql: 'SELECT * FROM data' })
})
```
