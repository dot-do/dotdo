[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardContext

# Interface: ShardContext

Defined in: workflows/context/shard.ts:126

Full context interface returned by createMockContext

## Properties

### \_registerMockNamespace()

> **\_registerMockNamespace**: (`name`, `namespace`) => `void`

Defined in: workflows/context/shard.ts:129

#### Parameters

##### name

`string`

##### namespace

`DurableObjectNamespace`

#### Returns

`void`

***

### \_storage

> **\_storage**: [`ShardStorage`](ShardStorage.md)

Defined in: workflows/context/shard.ts:128

***

### shard()

> **shard**: (`namespaceName`, `config?`) => [`ShardContextInstance`](ShardContextInstance.md)

Defined in: workflows/context/shard.ts:127

#### Parameters

##### namespaceName

`string`

##### config?

[`ShardContextConfig`](ShardContextConfig.md)

#### Returns

[`ShardContextInstance`](ShardContextInstance.md)
