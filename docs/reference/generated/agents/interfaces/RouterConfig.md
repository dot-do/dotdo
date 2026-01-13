[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / RouterConfig

# Interface: RouterConfig

Defined in: [agents/router/router.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L137)

Router configuration

## Properties

### budget?

> `optional` **budget**: [`BudgetConfig`](BudgetConfig.md)

Defined in: [agents/router/router.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L145)

Budget configuration

***

### fallback?

> `optional` **fallback**: [`FallbackConfig`](FallbackConfig.md)

Defined in: [agents/router/router.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L143)

Fallback configuration

***

### healthCheck?

> `optional` **healthCheck**: [`HealthCheckConfig`](HealthCheckConfig.md)

Defined in: [agents/router/router.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L147)

Health check configuration

***

### providers

> **providers**: [`ProviderConfig`](ProviderConfig.md)[]

Defined in: [agents/router/router.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L139)

Configured providers

***

### strategy?

> `optional` **strategy**: [`LoadBalanceStrategy`](../type-aliases/LoadBalanceStrategy.md)

Defined in: [agents/router/router.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L141)

Load balancing strategy
