[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardStorage

# Interface: ShardStorage

Defined in: workflows/context/shard.ts:114

Internal storage for shard context state

## Properties

### configs

> **configs**: `Map`\<`string`, [`ShardConfig`](ShardConfig.md)\>

Defined in: workflows/context/shard.ts:118

Namespace configurations

***

### managers

> **managers**: `Map`\<`string`, `ShardManager`\>

Defined in: workflows/context/shard.ts:116

Registered namespaces with their managers

***

### mockBindings

> **mockBindings**: `Map`\<`string`, `DurableObjectNamespace`\<`undefined`\>\>

Defined in: workflows/context/shard.ts:120

Mock namespace bindings for testing
