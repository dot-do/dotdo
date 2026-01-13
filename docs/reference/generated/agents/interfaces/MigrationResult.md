[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MigrationResult

# Interface: MigrationResult

Defined in: [agents/unified-memory.ts:927](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L927)

Migration statistics returned after migration completes

## Properties

### errors

> **errors**: `object`[]

Defined in: [agents/unified-memory.ts:935](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L935)

Errors encountered during migration

#### error

> **error**: `string`

#### id

> **id**: `string`

***

### failedCount

> **failedCount**: `number`

Defined in: [agents/unified-memory.ts:931](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L931)

Number of memories that failed to migrate

***

### migratedCount

> **migratedCount**: `number`

Defined in: [agents/unified-memory.ts:929](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L929)

Number of memories successfully migrated

***

### migratedIds

> **migratedIds**: `string`[]

Defined in: [agents/unified-memory.ts:933](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L933)

IDs of successfully migrated memories
