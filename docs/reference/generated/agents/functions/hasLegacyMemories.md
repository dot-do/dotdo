[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / hasLegacyMemories

# Function: hasLegacyMemories()

> **hasLegacyMemories**(`storage`): `Promise`\<`boolean`\>

Defined in: [agents/unified-memory.ts:1048](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L1048)

Check if a DurableObjectStorage has legacy memories that need migration.

## Parameters

### storage

`DurableObjectStorage`

The DurableObjectStorage to check

## Returns

`Promise`\<`boolean`\>

true if there are memories with the legacy `memory:` prefix
