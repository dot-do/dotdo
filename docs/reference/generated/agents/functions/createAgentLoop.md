[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createAgentLoop

# Function: createAgentLoop()

> **createAgentLoop**(`config`): [`AgentLoop`](../classes/AgentLoop.md)

Defined in: [agents/loop.ts:638](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L638)

Create an agent loop instance

## Parameters

### config

[`AgentLoopConfig`](../interfaces/AgentLoopConfig.md)

Loop configuration

## Returns

[`AgentLoop`](../classes/AgentLoop.md)

Configured AgentLoop instance

## Example

```ts
const loop = createAgentLoop({
  generate: async (messages, tools) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      tools: tools?.map(t => convertTool(t)),
    })
    return parseResponse(response)
  },
  tools: [searchTool],
  maxSteps: 10,
})

const result = await loop.run({ prompt: 'Search for recent AI news' })
```
