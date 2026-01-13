[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / checkCircularHandoff

# Function: checkCircularHandoff()

> **checkCircularHandoff**(`store`, `fromAgentId`, `toAgentId`, `conversationId?`): `Promise`\<[`CircularHandoffCheckResult`](../interfaces/CircularHandoffCheckResult.md)\>

Defined in: agents/handoff-chain.ts:350

Check if a proposed handoff would create a circular chain

Traverses backwards from the source agent to find the existing chain,
then checks if the target agent is already in that chain.

## Parameters

### store

`GraphStore`

The GraphStore instance

### fromAgentId

`string`

The agent initiating the handoff

### toAgentId

`string`

The proposed target agent

### conversationId?

`string`

Optional conversation ID to filter by

## Returns

`Promise`\<[`CircularHandoffCheckResult`](../interfaces/CircularHandoffCheckResult.md)\>

Result with isCircular flag and existing chain

## Example

```typescript
const check = await checkCircularHandoff(store, 'agent:tom', 'agent:ralph', 'conv:123')
if (check.isCircular) {
  throw new Error('Circular handoff detected')
}
```
