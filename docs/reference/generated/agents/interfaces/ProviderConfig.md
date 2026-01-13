[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ProviderConfig

# Interface: ProviderConfig

Defined in: [agents/router/router.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L78)

Configuration for a single provider

## Properties

### costPerToken?

> `optional` **costPerToken**: `object`

Defined in: [agents/router/router.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L92)

Cost per 1K tokens (for cost tracking and cost-based routing)

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### enabled?

> `optional` **enabled**: `boolean`

Defined in: [agents/router/router.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L90)

Whether this provider is enabled

***

### models?

> `optional` **models**: `string`[]

Defined in: [agents/router/router.ts:88](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L88)

Models supported by this provider

***

### name

> **name**: `string`

Defined in: [agents/router/router.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L80)

Unique name for the provider

***

### priority?

> `optional` **priority**: `number`

Defined in: [agents/router/router.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L84)

Priority (lower = higher priority, used for fallback ordering)

***

### provider

> **provider**: [`AgentProvider`](AgentProvider.md)

Defined in: [agents/router/router.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L82)

The actual provider implementation

***

### weight?

> `optional` **weight**: `number`

Defined in: [agents/router/router.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L86)

Weight for weighted load balancing (higher = more traffic)
