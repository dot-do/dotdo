[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createProgressMessage

# Function: createProgressMessage()

> **createProgressMessage**(`handoffId`, `sourceAgentId`, `targetAgentId`, `options`): [`HandoffProgressMessage`](../interfaces/HandoffProgressMessage.md)

Defined in: [agents/handoff.ts:1024](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L1024)

Create a progress message (Target -> Source)

## Parameters

### handoffId

`string`

### sourceAgentId

`string`

### targetAgentId

`string`

### options

#### correlationId?

`string`

#### currentStep?

`string`

#### estimatedRemainingMs?

`number`

#### partialResults?

`unknown`

#### progress?

`number`

## Returns

[`HandoffProgressMessage`](../interfaces/HandoffProgressMessage.md)
