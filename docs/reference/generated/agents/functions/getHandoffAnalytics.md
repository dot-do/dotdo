[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / getHandoffAnalytics

# Function: getHandoffAnalytics()

> **getHandoffAnalytics**(`store`, `options?`): `Promise`\<[`HandoffAnalytics`](../interfaces/HandoffAnalytics.md)\>

Defined in: agents/handoff-chain.ts:423

Get analytics about handoff patterns

Analyzes all handoff relationships to provide insights about:
- Total handoffs
- Distribution by reason
- Most common handoff pairs
- Agent participation as source and target

## Parameters

### store

`GraphStore`

The GraphStore instance

### options?

[`GetHandoffAnalyticsOptions`](../interfaces/GetHandoffAnalyticsOptions.md)

Optional filters (date range, conversation ID)

## Returns

`Promise`\<[`HandoffAnalytics`](../interfaces/HandoffAnalytics.md)\>

Analytics object with statistics

## Example

```typescript
const analytics = await getHandoffAnalytics(store, {
  conversationId: 'conv:123'
})
console.log(`Total handoffs: ${analytics.totalHandoffs}`)
console.log(`Top pair: ${analytics.topHandoffPairs[0]?.from} -> ${analytics.topHandoffPairs[0]?.to}`)
```
