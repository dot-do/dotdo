[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / expectAgentResult

# Function: expectAgentResult()

> **expectAgentResult**(`result`, `expected`): `void`

Defined in: [agents/testing.ts:648](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L648)

Assert that an agent result contains expected properties

## Parameters

### result

#### steps

`number`

#### text

`string`

#### toolCalls

[`ToolCall`](../interfaces/ToolCall.md)[]

### expected

#### maxSteps?

`number`

#### minSteps?

`number`

#### text?

`string` \| `RegExp`

#### toolCallCount?

`number`

## Returns

`void`
