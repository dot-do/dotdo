[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / createMetricsCollector

# Function: createMetricsCollector()

> **createMetricsCollector**(): `object`

Defined in: [lib/functions/FunctionMiddleware.ts:209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L209)

Create a simple in-memory metrics collector

## Returns

`object`

### clear()

> **clear**: () => `void`

#### Returns

`void`

### getMetrics()

> **getMetrics**: () => [`MetricsEntry`](../interfaces/MetricsEntry.md)[]

#### Returns

[`MetricsEntry`](../interfaces/MetricsEntry.md)[]

### getSummary()

> **getSummary**: () => `object`

#### Returns

`object`

##### avgDuration

> **avgDuration**: `number`

##### byFunction

> **byFunction**: `Record`\<`string`, \{ `avgDuration`: `number`; `count`: `number`; `successRate`: `number`; \}\>

##### failed

> **failed**: `number`

##### succeeded

> **succeeded**: `number`

##### total

> **total**: `number`

### middleware

> **middleware**: [`ExecutionMiddleware`](../type-aliases/ExecutionMiddleware.md)
