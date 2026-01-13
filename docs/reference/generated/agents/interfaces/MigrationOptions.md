[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MigrationOptions

# Interface: MigrationOptions

Defined in: [agents/unified-memory.ts:941](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L941)

Options for memory migration

## Properties

### batchSize?

> `optional` **batchSize**: `number`

Defined in: [agents/unified-memory.ts:945](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L945)

Batch size for migration (default: 50)

***

### deleteAfterMigration?

> `optional` **deleteAfterMigration**: `boolean`

Defined in: [agents/unified-memory.ts:943](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L943)

Whether to delete source memories after successful migration

***

### onProgress()?

> `optional` **onProgress**: (`migrated`, `total`) => `void`

Defined in: [agents/unified-memory.ts:947](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L947)

Callback for progress updates

#### Parameters

##### migrated

`number`

##### total

`number`

#### Returns

`void`
