[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RateLimitCapability

# Interface: RateLimitCapability

Defined in: [types/WorkflowContext.ts:861](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L861)

Rate limit capability on WorkflowContext

## Methods

### check()

> **check**(`key`, `options?`): `Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

Defined in: [types/WorkflowContext.ts:867](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L867)

Check if an action is rate limited without consuming quota

#### Parameters

##### key

`string`

Unique key for the rate limit (e.g., user ID, IP)

##### options?

[`RateLimitCheckOptions`](RateLimitCheckOptions.md)

Rate limit configuration

#### Returns

`Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

***

### consume()

> **consume**(`key`, `cost?`): `Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

Defined in: [types/WorkflowContext.ts:874](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L874)

Consume rate limit quota

#### Parameters

##### key

`string`

Unique key for the rate limit

##### cost?

`number`

Cost to consume (default 1)

#### Returns

`Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

***

### reset()

> **reset**(`key`): `Promise`\<`void`\>

Defined in: [types/WorkflowContext.ts:886](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L886)

Reset rate limit for a key

#### Parameters

##### key

`string`

Unique key to reset

#### Returns

`Promise`\<`void`\>

***

### status()

> **status**(`key`): `Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

Defined in: [types/WorkflowContext.ts:880](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L880)

Get current quota status without modifying it

#### Parameters

##### key

`string`

Unique key for the rate limit

#### Returns

`Promise`\<[`RateLimitResult`](RateLimitResult.md)\>
