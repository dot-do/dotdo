[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createHandoffRelationship

# Function: createHandoffRelationship()

> **createHandoffRelationship**(`store`, `input`): `Promise`\<[`HandoffRelationship`](../interfaces/HandoffRelationship.md)\>

Defined in: agents/handoff-chain.ts:224

Create a handoff relationship between two agents

This is the primary function for recording agent-to-agent handoffs.
The relationship ID includes conversationId to allow multiple handoffs
between the same agent pair in different conversations.

## Parameters

### store

`GraphStore`

The GraphStore instance

### input

[`CreateHandoffRelationshipInput`](../interfaces/CreateHandoffRelationshipInput.md)

Handoff details (from, to, reason, context, etc.)

## Returns

`Promise`\<[`HandoffRelationship`](../interfaces/HandoffRelationship.md)\>

The created handoff relationship

## Example

```typescript
const handoff = await createHandoffRelationship(store, {
  from: 'agent:ralph',
  to: 'agent:tom',
  reason: 'completion',
  context: { summary: 'Code implementation complete' },
  conversationId: 'conv:task-123'
})
```
