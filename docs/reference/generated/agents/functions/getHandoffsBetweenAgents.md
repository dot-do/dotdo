[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / getHandoffsBetweenAgents

# Function: getHandoffsBetweenAgents()

> **getHandoffsBetweenAgents**(`store`, `fromAgentId`, `toAgentId`, `conversationId?`): `Promise`\<[`HandoffRelationship`](../interfaces/HandoffRelationship.md)[]\>

Defined in: agents/handoff-chain.ts:524

Get handoffs between two specific agents

Finds all handoff relationships where the source and target match
the specified agent IDs, optionally filtered by conversation.

## Parameters

### store

`GraphStore`

The GraphStore instance

### fromAgentId

`string`

The source agent ID

### toAgentId

`string`

The target agent ID

### conversationId?

`string`

Optional conversation ID to filter by

## Returns

`Promise`\<[`HandoffRelationship`](../interfaces/HandoffRelationship.md)[]\>

Array of matching handoff relationships

## Example

```typescript
const handoffs = await getHandoffsBetweenAgents(store, 'agent:ralph', 'agent:tom')
console.log(`Found ${handoffs.length} handoffs from Ralph to Tom`)
```
