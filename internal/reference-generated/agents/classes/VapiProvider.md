[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / VapiProvider

# Class: VapiProvider

Defined in: [agents/providers/voice.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L83)

## Implements

- [`AgentProvider`](../interfaces/AgentProvider.md)

## Constructors

### Constructor

> **new VapiProvider**(`options`): `VapiProvider`

Defined in: [agents/providers/voice.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L89)

#### Parameters

##### options

[`VapiProviderOptions`](../interfaces/VapiProviderOptions.md)

#### Returns

`VapiProvider`

## Methods

### createAgent()

> **createAgent**(`config`): [`Agent`](../interfaces/Agent.md)

Defined in: [agents/providers/voice.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L105)

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

Defined in: [agents/providers/voice.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L124)

List available models

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`listModels`](../interfaces/AgentProvider.md#listmodels)

## Properties

### name

> `readonly` **name**: `"vapi"` = `'vapi'`

Defined in: [agents/providers/voice.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L84)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`name`](../interfaces/AgentProvider.md#name)

***

### version

> `readonly` **version**: `"1.0"` = `'1.0'`

Defined in: [agents/providers/voice.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L85)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`version`](../interfaces/AgentProvider.md#version)
