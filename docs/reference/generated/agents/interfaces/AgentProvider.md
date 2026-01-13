[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentProvider

# Interface: AgentProvider

Defined in: [agents/types.ts:495](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L495)

## Methods

### createAgent()

> **createAgent**(`config`): [`Agent`](Agent.md)

Defined in: [agents/types.ts:500](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L500)

Create an agent instance

#### Parameters

##### config

[`AgentConfig`](AgentConfig.md)

#### Returns

[`Agent`](Agent.md)

***

### createSession()?

> `optional` **createSession**(`options`): `Promise`\<[`Session`](Session.md)\>

Defined in: [agents/types.ts:503](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L503)

For session-based providers: create a session

#### Parameters

##### options

[`CreateSessionOptions`](CreateSessionOptions.md)

#### Returns

`Promise`\<[`Session`](Session.md)\>

***

### getSession()?

> `optional` **getSession**(`sessionId`): `Promise`\<[`Session`](Session.md) \| `null`\>

Defined in: [agents/types.ts:506](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L506)

For session-based providers: get session

#### Parameters

##### sessionId

`string`

#### Returns

`Promise`\<[`Session`](Session.md) \| `null`\>

***

### listModels()?

> `optional` **listModels**(): `Promise`\<`string`[]\>

Defined in: [agents/types.ts:518](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L518)

List available models

#### Returns

`Promise`\<`string`[]\>

***

### sendMessage()?

> `optional` **sendMessage**(`options`): `Promise`\<[`AgentResult`](AgentResult.md)\>

Defined in: [agents/types.ts:509](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L509)

For session-based providers: send message

#### Parameters

##### options

[`SendMessageOptions`](SendMessageOptions.md)

#### Returns

`Promise`\<[`AgentResult`](AgentResult.md)\>

***

### streamMessage()?

> `optional` **streamMessage**(`options`): [`AgentStreamResult`](AgentStreamResult.md)

Defined in: [agents/types.ts:512](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L512)

For session-based providers: stream message

#### Parameters

##### options

[`SendMessageOptions`](SendMessageOptions.md)

#### Returns

[`AgentStreamResult`](AgentStreamResult.md)

***

### uploadAttachment()?

> `optional` **uploadAttachment**(`file`): `Promise`\<[`Attachment`](Attachment.md)\>

Defined in: [agents/types.ts:515](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L515)

Upload attachment (Devin pattern)

#### Parameters

##### file

`File`

#### Returns

`Promise`\<[`Attachment`](Attachment.md)\>

## Properties

### name

> `readonly` **name**: `string`

Defined in: [agents/types.ts:496](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L496)

***

### version

> `readonly` **version**: `string`

Defined in: [agents/types.ts:497](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L497)
