[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardContextInstance

# Interface: ShardContextInstance

Defined in: workflows/context/shard.ts:48

Shard context instance returned by $.shard(namespace)

## Methods

### config()

> **config**(): [`ShardConfig`](ShardConfig.md)

Defined in: workflows/context/shard.ts:98

Get current configuration

#### Returns

[`ShardConfig`](ShardConfig.md)

***

### getAllShardStubs()

> **getAllShardStubs**(): `DurableObjectStub`\<`undefined`\>[]

Defined in: workflows/context/shard.ts:93

Get all shard stubs

#### Returns

`DurableObjectStub`\<`undefined`\>[]

***

### getShardId()

> **getShardId**(`key`): `number`

Defined in: workflows/context/shard.ts:59

Get shard index for a key value

#### Parameters

##### key

`string`

The key to hash

#### Returns

`number`

Shard index [0, count)

***

### getShardStub()

> **getShardStub**(`key`): `Promise`\<`DurableObjectStub`\<`undefined`\>\>

Defined in: workflows/context/shard.ts:66

Get DO stub for a specific shard key value

#### Parameters

##### key

`string`

The shard key value (e.g., tenant ID)

#### Returns

`Promise`\<`DurableObjectStub`\<`undefined`\>\>

DO stub for the appropriate shard

***

### getShardStubForSql()

> **getShardStubForSql**(`sql`, `params?`): `Promise`\<`DurableObjectStub`\<`undefined`\> \| `undefined`\>

Defined in: workflows/context/shard.ts:74

Get DO stub by extracting shard key from SQL

#### Parameters

##### sql

`string`

SQL statement

##### params?

Query parameters

`Record`\<`string`, `unknown`\> | `unknown`[]

#### Returns

`Promise`\<`DurableObjectStub`\<`undefined`\> \| `undefined`\>

DO stub or undefined if no shard key found

***

### manager()

> **manager**(): `ShardManager`

Defined in: workflows/context/shard.ts:52

Get the ShardManager for this namespace

#### Returns

`ShardManager`

***

### queryAll()

> **queryAll**\<`T`\>(`path`, `init?`): `Promise`\<[`ShardQueryResult`](ShardQueryResult.md)\<`T`\>[]\>

Defined in: workflows/context/shard.ts:85

Fan out a query to all shards

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### path

`string`

Request path

##### init?

`RequestInit`\<`CfProperties`\<`unknown`\>\>

Fetch init options

#### Returns

`Promise`\<[`ShardQueryResult`](ShardQueryResult.md)\<`T`\>[]\>

Array of results from each shard

***

### shardCount()

> **shardCount**(): `number`

Defined in: workflows/context/shard.ts:103

Get shard count

#### Returns

`number`

***

### shardKey()

> **shardKey**(): `string`

Defined in: workflows/context/shard.ts:108

Get shard key field name

#### Returns

`string`
