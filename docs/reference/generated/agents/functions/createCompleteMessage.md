[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createCompleteMessage

# Function: createCompleteMessage()

> **createCompleteMessage**(`initiateMessage`, `result`, `durationMs`, `options`): [`HandoffCompleteMessage`](../interfaces/HandoffCompleteMessage.md)

Defined in: [agents/handoff.ts:1053](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L1053)

Create a completion message (Target -> Source)

## Parameters

### initiateMessage

[`HandoffInitiateMessage`](../interfaces/HandoffInitiateMessage.md)

### result

[`AgentResult`](../interfaces/AgentResult.md)

### durationMs

`number`

### options

#### followUp?

\{ `instructions?`: `string`; `needsHandoff?`: `boolean`; `suggestedAgent?`: `string`; \}

#### followUp.instructions?

`string`

#### followUp.needsHandoff?

`boolean`

#### followUp.suggestedAgent?

`string`

#### summary?

`string`

## Returns

[`HandoffCompleteMessage`](../interfaces/HandoffCompleteMessage.md)
