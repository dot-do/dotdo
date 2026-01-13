[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createRouter

# Function: createRouter()

> **createRouter**(`config`): [`LLMRouter`](../classes/LLMRouter.md)

Defined in: [agents/router/router.ts:827](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L827)

Create an LLM Router

## Parameters

### config

[`RouterConfig`](../interfaces/RouterConfig.md)

## Returns

[`LLMRouter`](../classes/LLMRouter.md)

## Example

```ts
const router = createRouter({
  providers: [
    { name: 'openai', provider: createOpenAIProvider(), priority: 1 },
    { name: 'anthropic', provider: createClaudeProvider(), priority: 2 },
  ],
  strategy: 'priority',
  fallback: { enabled: true },
})
```
