[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / hasQueue

# ~~Function: hasQueue()~~

> **hasQueue**(`env`): `env is CloudflareEnv & { QUEUE: Queue }`

Defined in: [types/CloudflareBindings.ts:504](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L504)

Check if Queue binding is available

## Parameters

### env

[`CloudflareEnv`](../interfaces/CloudflareEnv.md)

## Returns

`env is CloudflareEnv & { QUEUE: Queue }`

## Deprecated

Use hasEventsQueue, hasJobsQueue, or hasWebhooksQueue instead
