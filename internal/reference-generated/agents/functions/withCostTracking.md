[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / withCostTracking

# Function: withCostTracking()

> **withCostTracking**(`agent`, `tracker`, `options?`): [`AgentWithCostTracking`](../interfaces/AgentWithCostTracking.md)

Defined in: [agents/cost-tracker.ts:606](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L606)

Wrap an agent with automatic cost tracking

## Parameters

### agent

[`Agent`](../interfaces/Agent.md)

### tracker

[`CostTracker`](../classes/CostTracker.md)

### options?

#### provider?

`string`

## Returns

[`AgentWithCostTracking`](../interfaces/AgentWithCostTracking.md)

## Example

```ts
const tracker = createCostTracker({ budget: { maxCost: 5.0 } })
const trackedAgent = withCostTracking(agent, tracker)

const result = await trackedAgent.run({ prompt: 'Hello!' })
console.log('Cost so far:', trackedAgent.getTotalCost())
```
