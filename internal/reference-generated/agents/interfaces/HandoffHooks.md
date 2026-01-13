[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffHooks

# Interface: HandoffHooks

Defined in: [agents/handoff.ts:380](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L380)

Hooks for customizing handoff behavior

## Properties

### onAccepted()?

> `optional` **onAccepted**: (`accept`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:398](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L398)

Called when handoff is accepted by target

#### Parameters

##### accept

[`HandoffAcceptMessage`](HandoffAcceptMessage.md)

#### Returns

`Promise`\<`void`\>

***

### onAckReceived()?

> `optional` **onAckReceived**: (`ack`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:396](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L396)

Called when acknowledgment is received from target

#### Parameters

##### ack

[`HandoffAckMessage`](HandoffAckMessage.md)

#### Returns

`Promise`\<`void`\>

***

### onBeforeHandoff()?

> `optional` **onBeforeHandoff**: (`request`) => `Promise`\<`HandoffRequest` \| `null`\>

Defined in: [agents/handoff.ts:382](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L382)

Called before handoff is initiated

#### Parameters

##### request

`HandoffRequest`

#### Returns

`Promise`\<`HandoffRequest` \| `null`\>

***

### onContextTransfer()?

> `optional` **onContextTransfer**: (`context`) => `Promise`\<[`HandoffContext`](HandoffContext.md)\>

Defined in: [agents/handoff.ts:384](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L384)

Called when context is being transferred

#### Parameters

##### context

[`HandoffContext`](HandoffContext.md)

#### Returns

`Promise`\<[`HandoffContext`](HandoffContext.md)\>

***

### onHandoffComplete()?

> `optional` **onHandoffComplete**: (`result`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:388](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L388)

Called when handoff completes

#### Parameters

##### result

[`HandoffResult`](HandoffResult.md)

#### Returns

`Promise`\<`void`\>

***

### onHandoffError()?

> `optional` **onHandoffError**: (`request`, `error`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:390](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L390)

Called when handoff fails

#### Parameters

##### request

`HandoffRequest`

##### error

`Error`

#### Returns

`Promise`\<`void`\>

***

### onHandoffStart()?

> `optional` **onHandoffStart**: (`request`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:386](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L386)

Called when target agent starts processing

#### Parameters

##### request

`HandoffRequest`

#### Returns

`Promise`\<`void`\>

***

### onMessageReceived()?

> `optional` **onMessageReceived**: (`message`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:406](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L406)

Called when protocol message is received

#### Parameters

##### message

[`HandoffMessage`](../type-aliases/HandoffMessage.md)

#### Returns

`Promise`\<`void`\>

***

### onMessageSent()?

> `optional` **onMessageSent**: (`message`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:404](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L404)

Called when protocol message is sent

#### Parameters

##### message

[`HandoffMessage`](../type-aliases/HandoffMessage.md)

#### Returns

`Promise`\<`void`\>

***

### onProgress()?

> `optional` **onProgress**: (`progress`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:402](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L402)

Called when progress update is received

#### Parameters

##### progress

[`HandoffProgressMessage`](HandoffProgressMessage.md)

#### Returns

`Promise`\<`void`\>

***

### onRejected()?

> `optional` **onRejected**: (`reject`) => `Promise`\<`void`\>

Defined in: [agents/handoff.ts:400](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L400)

Called when handoff is rejected by target

#### Parameters

##### reject

[`HandoffRejectMessage`](HandoffRejectMessage.md)

#### Returns

`Promise`\<`void`\>

***

### validateHandoff()?

> `optional` **validateHandoff**: (`request`) => `Promise`\<`boolean`\>

Defined in: [agents/handoff.ts:392](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L392)

Called to validate if handoff is allowed

#### Parameters

##### request

`HandoffRequest`

#### Returns

`Promise`\<`boolean`\>
