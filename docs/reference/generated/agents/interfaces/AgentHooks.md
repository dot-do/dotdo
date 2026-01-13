[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentHooks

# Interface: AgentHooks

Defined in: [agents/types.ts:438](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L438)

## Properties

### onError()?

> `optional` **onError**: (`error`) => `Promise`\<`void`\>

Defined in: [agents/types.ts:450](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L450)

Called on error

#### Parameters

##### error

`Error`

#### Returns

`Promise`\<`void`\>

***

### onPermissionRequest()?

> `optional` **onPermissionRequest**: (`request`) => `Promise`\<`boolean`\>

Defined in: [agents/types.ts:444](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L444)

Called when permission is needed

#### Parameters

##### request

[`PermissionRequest`](PermissionRequest.md)

#### Returns

`Promise`\<`boolean`\>

***

### onPostToolUse()?

> `optional` **onPostToolUse**: (`toolCall`, `result`) => `Promise`\<`void`\>

Defined in: [agents/types.ts:442](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L442)

Called after a tool completes

#### Parameters

##### toolCall

[`ToolCall`](ToolCall.md)

##### result

[`ToolResult`](ToolResult.md)

#### Returns

`Promise`\<`void`\>

***

### onPreToolUse()?

> `optional` **onPreToolUse**: (`toolCall`) => `Promise`\<[`ToolCallDecision`](../type-aliases/ToolCallDecision.md)\>

Defined in: [agents/types.ts:440](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L440)

Called before a tool is used

#### Parameters

##### toolCall

[`ToolCall`](ToolCall.md)

#### Returns

`Promise`\<[`ToolCallDecision`](../type-aliases/ToolCallDecision.md)\>

***

### onStepFinish()?

> `optional` **onStepFinish**: (`step`, `stepNumber`) => `Promise`\<`void`\>

Defined in: [agents/types.ts:448](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L448)

Called when step finishes

#### Parameters

##### step

[`StepResult`](StepResult.md)

##### stepNumber

`number`

#### Returns

`Promise`\<`void`\>

***

### onStepStart()?

> `optional` **onStepStart**: (`stepNumber`, `state`) => `Promise`\<`void`\>

Defined in: [agents/types.ts:446](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L446)

Called when step starts

#### Parameters

##### stepNumber

`number`

##### state

[`StepState`](StepState.md)

#### Returns

`Promise`\<`void`\>
