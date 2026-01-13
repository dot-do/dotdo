[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / extractShardKey

# Function: extractShardKey()

> **extractShardKey**(`sql`, `shardKey`, `params?`): `string` \| `undefined`

Defined in: [db/core/shard.ts:235](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L235)

Extract shard key value from SQL statement

Supports:
- WHERE tenant_id = 'value'
- WHERE tenant_id = ?
- WHERE tenant_id = :tenant_id
- INSERT INTO ... VALUES (..., 'value', ...)
- UPDATE ... WHERE tenant_id = 'value'

## Parameters

### sql

`string`

SQL statement

### shardKey

`string`

Name of shard key column

### params?

Query parameters (array or object)

`Record`\<`string`, `unknown`\> | `unknown`[]

## Returns

`string` \| `undefined`

Extracted key value or undefined
