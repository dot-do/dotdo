[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HealthCheckConfig

# Interface: HealthCheckConfig

Defined in: [agents/router/router.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L127)

Health check configuration

## Properties

### failureThreshold?

> `optional` **failureThreshold**: `number`

Defined in: [agents/router/router.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L129)

Number of consecutive failures before marking unhealthy

***

### recoveryPeriodMs?

> `optional` **recoveryPeriodMs**: `number`

Defined in: [agents/router/router.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L131)

Time in ms before attempting to recover unhealthy provider
