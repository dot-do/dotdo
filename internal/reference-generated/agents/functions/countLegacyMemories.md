[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / countLegacyMemories

# Function: countLegacyMemories()

> **countLegacyMemories**(`storage`): `Promise`\<`number`\>

Defined in: [agents/unified-memory.ts:1059](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L1059)

Count the number of legacy memories in DurableObjectStorage.

## Parameters

### storage

`DurableObjectStorage`

The DurableObjectStorage to check

## Returns

`Promise`\<`number`\>

The number of memories stored with the `memory:` prefix
