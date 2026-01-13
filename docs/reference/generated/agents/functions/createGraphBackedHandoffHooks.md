[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createGraphBackedHandoffHooks

# Function: createGraphBackedHandoffHooks()

> **createGraphBackedHandoffHooks**(`store`, `options?`): `Partial`\<[`HandoffHooks`](../interfaces/HandoffHooks.md)\>

Defined in: agents/handoff-chain.ts:568

Create graph-backed handoff hooks for integration with HandoffProtocol

This function returns hooks that can be passed to HandoffProtocol to
automatically track handoffs in the graph store.

## Parameters

### store

`GraphStore`

The GraphStore instance

### options?

Optional configuration (enableCircularCheck, etc.)

#### defaultConversationId?

`string`

Default conversation ID if not specified in request

#### enableCircularCheck?

`boolean`

Enable circular handoff detection (default: true)

## Returns

`Partial`\<[`HandoffHooks`](../interfaces/HandoffHooks.md)\>

Partial HandoffHooks that can be merged with other hooks

## Example

```typescript
const graphHooks = createGraphBackedHandoffHooks(store)
const protocol = new HandoffProtocol({
  provider,
  agents,
  hooks: {
    ...graphHooks,
    // Additional custom hooks...
  }
})
```
