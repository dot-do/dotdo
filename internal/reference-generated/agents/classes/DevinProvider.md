[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / DevinProvider

# Class: DevinProvider

Defined in: [agents/providers/devin.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L73)

## Implements

- [`AgentProvider`](../interfaces/AgentProvider.md)

## Constructors

### Constructor

> **new DevinProvider**(`options`): `DevinProvider`

Defined in: [agents/providers/devin.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L80)

#### Parameters

##### options

[`DevinProviderOptions`](../interfaces/DevinProviderOptions.md)

#### Returns

`DevinProvider`

## Methods

### createAgent()

> **createAgent**(`config`): [`Agent`](../interfaces/Agent.md)

Defined in: [agents/providers/devin.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L93)

Create an agent - for Devin this creates a session-based agent

#### Parameters

##### config

[`AgentConfig`](../interfaces/AgentConfig.md)

#### Returns

[`Agent`](../interfaces/Agent.md)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`createAgent`](../interfaces/AgentProvider.md#createagent)

***

### createSession()

> **createSession**(`options`): `Promise`\<[`Session`](../interfaces/Session.md)\>

Defined in: [agents/providers/devin.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L127)

For session-based providers: create a session

#### Parameters

##### options

[`CreateSessionOptions`](../interfaces/CreateSessionOptions.md)

#### Returns

`Promise`\<[`Session`](../interfaces/Session.md)\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`createSession`](../interfaces/AgentProvider.md#createsession)

***

### getSession()

> **getSession**(`sessionId`): `Promise`\<[`Session`](../interfaces/Session.md) \| `null`\>

Defined in: [agents/providers/devin.ts:169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L169)

For session-based providers: get session

#### Parameters

##### sessionId

`string`

#### Returns

`Promise`\<[`Session`](../interfaces/Session.md) \| `null`\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`getSession`](../interfaces/AgentProvider.md#getsession)

***

### listModels()

> **listModels**(): `Promise`\<`string`[]\>

Defined in: [agents/providers/devin.ts:406](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L406)

List available models

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`listModels`](../interfaces/AgentProvider.md#listmodels)

***

### sendMessage()

> **sendMessage**(`options`): `Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Defined in: [agents/providers/devin.ts:192](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L192)

For session-based providers: send message

#### Parameters

##### options

[`SendMessageOptions`](../interfaces/SendMessageOptions.md)

#### Returns

`Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`sendMessage`](../interfaces/AgentProvider.md#sendmessage)

***

### streamMessage()

> **streamMessage**(`options`): [`AgentStreamResult`](../interfaces/AgentStreamResult.md)

Defined in: [agents/providers/devin.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L206)

For session-based providers: stream message

#### Parameters

##### options

[`SendMessageOptions`](../interfaces/SendMessageOptions.md)

#### Returns

[`AgentStreamResult`](../interfaces/AgentStreamResult.md)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`streamMessage`](../interfaces/AgentProvider.md#streammessage)

***

### uploadAttachment()

> **uploadAttachment**(`file`): `Promise`\<[`Attachment`](../interfaces/Attachment.md)\>

Defined in: [agents/providers/devin.ts:293](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L293)

Upload attachment (Devin pattern)

#### Parameters

##### file

`File`

#### Returns

`Promise`\<[`Attachment`](../interfaces/Attachment.md)\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`uploadAttachment`](../interfaces/AgentProvider.md#uploadattachment)

## Properties

### name

> `readonly` **name**: `"devin"` = `'devin'`

Defined in: [agents/providers/devin.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L74)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`name`](../interfaces/AgentProvider.md#name)

***

### version

> `readonly` **version**: `"1.0"` = `'1.0'`

Defined in: [agents/providers/devin.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/devin.ts#L75)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`version`](../interfaces/AgentProvider.md#version)
