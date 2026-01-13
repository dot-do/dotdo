[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createMockProvider

# Function: createMockProvider()

> **createMockProvider**(`options`): [`AgentProvider`](../interfaces/AgentProvider.md)

Defined in: [agents/testing.ts:402](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L402)

Create a mock provider for testing

The provider returns responses in sequence for each step.
Once responses are exhausted, it returns a default "No more responses" text.

## Parameters

### options

[`MockProviderOptions`](../interfaces/MockProviderOptions.md)

## Returns

[`AgentProvider`](../interfaces/AgentProvider.md)

## Example

```ts
const provider = createMockProvider({
  responses: [
    mockResponses.text('First response'),
    mockResponses.toolCall('search', { query: 'test' }),
    mockResponses.text('Final response'),
  ],
})

const agent = provider.createAgent({
  id: 'test',
  name: 'Test',
  instructions: 'You are a test agent',
  model: 'mock',
})

const result = await agent.run({ prompt: 'Hello' })
```
