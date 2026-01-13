[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ClaudeProvider

# Class: ClaudeProvider

Defined in: [agents/providers/claude.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L41)

## Implements

- [`AgentProvider`](../interfaces/AgentProvider.md)

## Constructors

### Constructor

> **new ClaudeProvider**(`options`): `ClaudeProvider`

Defined in: [agents/providers/claude.ts:48](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L48)

#### Parameters

##### options

[`ClaudeProviderOptions`](../interfaces/ClaudeProviderOptions.md) = `{}`

#### Returns

`ClaudeProvider`

## Methods

### convertMessages()

> **convertMessages**(`messages`): `unknown`[]

Defined in: [agents/providers/claude.ts:281](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L281)

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

#### Returns

`unknown`[]

***

### convertTools()

> **convertTools**(`tools`): `unknown`[]

Defined in: [agents/providers/claude.ts:337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L337)

#### Parameters

##### tools

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\>[]

#### Returns

`unknown`[]

***

### createAgent()

> **createAgent**(`config`): [`Agent`](../interfaces/Agent.md)

Defined in: [agents/providers/claude.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L57)

Create an agent instance

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

Defined in: [agents/providers/claude.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L73)

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

Defined in: [agents/providers/claude.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L100)

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

Defined in: [agents/providers/claude.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L347)

List available models

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`listModels`](../interfaces/AgentProvider.md#listmodels)

***

### sendMessage()

> **sendMessage**(`options`): `Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Defined in: [agents/providers/claude.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L104)

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

Defined in: [agents/providers/claude.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L135)

For session-based providers: stream message

#### Parameters

##### options

[`SendMessageOptions`](../interfaces/SendMessageOptions.md)

#### Returns

[`AgentStreamResult`](../interfaces/AgentStreamResult.md)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`streamMessage`](../interfaces/AgentProvider.md#streammessage)

## Properties

### name

> `readonly` **name**: `"claude"` = `'claude'`

Defined in: [agents/providers/claude.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L42)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`name`](../interfaces/AgentProvider.md#name)

***

### version

> `readonly` **version**: `"2.0"` = `'2.0'`

Defined in: [agents/providers/claude.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/claude.ts#L43)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`version`](../interfaces/AgentProvider.md#version)
