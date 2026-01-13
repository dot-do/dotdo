[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / VercelProvider

# Class: VercelProvider

Defined in: [agents/providers/vercel.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/vercel.ts#L38)

## Implements

- [`AgentProvider`](../interfaces/AgentProvider.md)

## Constructors

### Constructor

> **new VercelProvider**(`options`): `VercelProvider`

Defined in: [agents/providers/vercel.ts:44](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/vercel.ts#L44)

#### Parameters

##### options

[`VercelProviderOptions`](../interfaces/VercelProviderOptions.md) = `{}`

#### Returns

`VercelProvider`

## Methods

### createAgent()

> **createAgent**(`config`): [`Agent`](../interfaces/Agent.md)

Defined in: [agents/providers/vercel.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/vercel.ts#L51)

Create an agent instance

#### Parameters

##### config

[`AgentConfig`](../interfaces/AgentConfig.md)

#### Returns

[`Agent`](../interfaces/Agent.md)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`createAgent`](../interfaces/AgentProvider.md#createagent)

***

### listModels()

> **listModels**(): `Promise`\<`string`[]\>

Defined in: [agents/providers/vercel.ts:218](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/vercel.ts#L218)

List available models

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`listModels`](../interfaces/AgentProvider.md#listmodels)

## Properties

### name

> `readonly` **name**: `"vercel"` = `'vercel'`

Defined in: [agents/providers/vercel.ts:39](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/vercel.ts#L39)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`name`](../interfaces/AgentProvider.md#name)

***

### version

> `readonly` **version**: `"6.0"` = `'6.0'`

Defined in: [agents/providers/vercel.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/vercel.ts#L40)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`version`](../interfaces/AgentProvider.md#version)
