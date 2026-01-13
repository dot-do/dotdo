[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentLoopConfig

# Interface: AgentLoopConfig

Defined in: [agents/loop.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L72)

Configuration for the agent loop

## Properties

### agentId?

> `optional` **agentId**: `string`

Defined in: [agents/loop.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L84)

Agent ID for tool context

***

### generate()

> **generate**: (`messages`, `tools?`) => `Promise`\<[`StepResult`](StepResult.md)\>

Defined in: [agents/loop.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L74)

Function to call LLM for think phase

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

##### tools?

[`ToolDefinition`](ToolDefinition.md)\<`unknown`, `unknown`\>[]

#### Returns

`Promise`\<[`StepResult`](StepResult.md)\>

***

### hooks?

> `optional` **hooks**: [`AgentHooks`](AgentHooks.md)

Defined in: [agents/loop.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L82)

Hooks for customization

***

### maxSteps?

> `optional` **maxSteps**: `number`

Defined in: [agents/loop.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L80)

Maximum steps before forcing stop

***

### signal?

> `optional` **signal**: `AbortSignal`

Defined in: [agents/loop.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L86)

Abort signal

***

### stopWhen?

> `optional` **stopWhen**: [`StopCondition`](../type-aliases/StopCondition.md) \| [`StopCondition`](../type-aliases/StopCondition.md)[]

Defined in: [agents/loop.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L78)

Stop conditions

***

### tools?

> `optional` **tools**: [`ToolDefinition`](ToolDefinition.md)\<`unknown`, `unknown`\>[]

Defined in: [agents/loop.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L76)

Available tools for act phase
