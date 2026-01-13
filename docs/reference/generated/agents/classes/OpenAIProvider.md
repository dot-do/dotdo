[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / OpenAIProvider

# Class: OpenAIProvider

Defined in: [agents/providers/openai.ts:39](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/openai.ts#L39)

## Implements

- [`AgentProvider`](../interfaces/AgentProvider.md)

## Constructors

### Constructor

> **new OpenAIProvider**(`options`): `OpenAIProvider`

Defined in: [agents/providers/openai.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/openai.ts#L46)

#### Parameters

##### options

[`OpenAIProviderOptions`](../interfaces/OpenAIProviderOptions.md) = `{}`

#### Returns

`OpenAIProvider`

## Methods

### createAgent()

> **createAgent**(`config`): [`Agent`](../interfaces/Agent.md)

Defined in: [agents/providers/openai.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/openai.ts#L54)

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

Defined in: [agents/providers/openai.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/openai.ts#L291)

List available models

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`listModels`](../interfaces/AgentProvider.md#listmodels)

## Properties

### name

> `readonly` **name**: `"openai"` = `'openai'`

Defined in: [agents/providers/openai.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/openai.ts#L40)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`name`](../interfaces/AgentProvider.md#name)

***

### version

> `readonly` **version**: `"1.0"` = `'1.0'`

Defined in: [agents/providers/openai.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/openai.ts#L41)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`version`](../interfaces/AgentProvider.md#version)
