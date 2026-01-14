[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / DataStorage

# Interface: DataStorage

Defined in: workflows/data/index.ts:293

Internal storage interface

## Properties

### collections

> **collections**: `Map`\<`string`, `Map`\<`string`, `Record`\<`string`, `unknown`\>\>\>

Defined in: workflows/data/index.ts:297

Collection stores

***

### kv

> **kv**: `Map`\<`string`, \{ `expiresAt?`: `number`; `value`: `unknown`; \}\>

Defined in: workflows/data/index.ts:295

Key-value store

***

### watchers

> **watchers**: `Map`\<`string`, `Set`\<\{ `callback`: [`WatchCallback`](../type-aliases/WatchCallback.md)\<`unknown`\>; `filter?`: [`QueryFilter`](../type-aliases/QueryFilter.md)\<`Record`\<`string`, `unknown`\>\>; \}\>\>

Defined in: workflows/data/index.ts:299

Watch subscriptions
