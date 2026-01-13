[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / getHandoffChain

# Function: getHandoffChain()

> **getHandoffChain**(`store`, `startAgentId`, `conversationId?`, `options?`): `Promise`\<[`GraphHandoffChainEntry`](../interfaces/GraphHandoffChainEntry.md)[]\>

Defined in: agents/handoff-chain.ts:270

Get the complete handoff chain starting from a given agent

Traverses the graph to find all handoffs in a chain, following
`handedOffTo` relationships from the starting agent.

## Parameters

### store

`GraphStore`

The GraphStore instance

### startAgentId

`string`

The agent ID to start from

### conversationId?

`string`

Optional conversation ID to filter by

### options?

[`GetHandoffChainOptions`](../interfaces/GetHandoffChainOptions.md)

Optional traversal options (maxDepth, includeDeleted)

## Returns

`Promise`\<[`GraphHandoffChainEntry`](../interfaces/GraphHandoffChainEntry.md)[]\>

Array of chain entries in traversal order

## Example

```typescript
const chain = await getHandoffChain(store, 'agent:ralph', 'conv:123')
// Returns: [{ agentId: 'agent:ralph' }, { agentId: 'agent:tom' }, ...]
```
