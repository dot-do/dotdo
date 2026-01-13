[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / migrateMemory

# Function: migrateMemory()

> **migrateMemory**(`source`, `target`, `options`): `Promise`\<[`MigrationResult`](../interfaces/MigrationResult.md)\>

Defined in: [agents/unified-memory.ts:969](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L969)

Migrate memories from DurableObjectStorage (ctx.storage) to GraphBackedAgentMemory.

This function reads all memories stored with the `memory:` prefix in ctx.storage
and migrates them to the unified graph-backed memory system.

## Parameters

### source

`DurableObjectStorage`

The DurableObjectStorage to read memories from

### target

[`AgentMemory`](../interfaces/AgentMemory.md)

The AgentMemory to migrate memories to

### options

[`MigrationOptions`](../interfaces/MigrationOptions.md) = `{}`

Migration options

## Returns

`Promise`\<[`MigrationResult`](../interfaces/MigrationResult.md)\>

Migration result with counts and any errors

## Example

```typescript
// In a Durable Object
const graphMemory = createGraphMemory({ store, agentId: this.ctx.id.toString() })
const result = await migrateMemory(this.ctx.storage, graphMemory)
console.log(`Migrated ${result.migratedCount} memories`)
```
