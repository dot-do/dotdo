[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createIsolatedMockProvider

# Function: createIsolatedMockProvider()

> **createIsolatedMockProvider**(`options`): [`AgentProvider`](../interfaces/AgentProvider.md)

Defined in: [agents/testing.ts:496](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L496)

Create a mock provider that resets step index for each agent

Unlike createMockProvider which shares state across all agents,
this creates isolated instances where each agent starts from step 0.

## Parameters

### options

[`MockProviderOptions`](../interfaces/MockProviderOptions.md)

## Returns

[`AgentProvider`](../interfaces/AgentProvider.md)
