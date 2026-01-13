[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentConfig

# Interface: AgentConfig

Defined in: [agents/types.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L125)

## Properties

### canSpawnSubagents?

> `optional` **canSpawnSubagents**: `boolean`

Defined in: [agents/types.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L149)

Can spawn subagents?

***

### handoffs?

> `optional` **handoffs**: `AgentConfig`[]

Defined in: [agents/types.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L147)

Agents this agent can hand off to

***

### id

> **id**: `string`

Defined in: [agents/types.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L127)

Unique identifier for the agent

***

### instructions

> **instructions**: `string`

Defined in: [agents/types.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L131)

System prompt / instructions

***

### maxSteps?

> `optional` **maxSteps**: `number`

Defined in: [agents/types.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L141)

Maximum steps before forcing stop

***

### memory?

> `optional` **memory**: [`MemoryConfig`](MemoryConfig.md)

Defined in: [agents/types.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L157)

Memory/context store

***

### model

> **model**: `string`

Defined in: [agents/types.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L133)

Model identifier (provider-specific or unified)

***

### name

> **name**: `string`

Defined in: [agents/types.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L129)

Human-readable name

***

### prepareStep?

> `optional` **prepareStep**: [`PrepareStepFn`](../type-aliases/PrepareStepFn.md)

Defined in: [agents/types.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L143)

Hook called before each step

***

### providerOptions?

> `optional` **providerOptions**: `Record`\<`string`, `unknown`\>

Defined in: [agents/types.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L160)

***

### stopWhen?

> `optional` **stopWhen**: [`StopCondition`](../type-aliases/StopCondition.md) \| [`StopCondition`](../type-aliases/StopCondition.md)[]

Defined in: [agents/types.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L139)

Stopping conditions

***

### tools?

> `optional` **tools**: [`ToolDefinition`](ToolDefinition.md)\<`unknown`, `unknown`\>[]

Defined in: [agents/types.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L135)

Available tools

***

### voice?

> `optional` **voice**: [`VoiceConfig`](VoiceConfig.md)

Defined in: [agents/types.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L153)

Voice configuration for voice agents
