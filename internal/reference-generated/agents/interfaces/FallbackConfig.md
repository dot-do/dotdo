[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / FallbackConfig

# Interface: FallbackConfig

Defined in: [agents/router/router.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L101)

Fallback configuration

## Properties

### enabled?

> `optional` **enabled**: `boolean`

Defined in: [agents/router/router.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L103)

Whether fallback is enabled

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [agents/router/router.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L105)

Maximum retry attempts across all providers

***

### retryDelayMs?

> `optional` **retryDelayMs**: `number`

Defined in: [agents/router/router.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L107)

Delay between retries in milliseconds
