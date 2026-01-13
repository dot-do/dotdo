[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentLoopEvent

# Type Alias: AgentLoopEvent

> **AgentLoopEvent** = \{ `step`: [`AgentLoopStep`](../interfaces/AgentLoopStep.md); `type`: `"step-start"`; \} \| \{ `messages`: [`Message`](Message.md)[]; `stepNumber`: `number`; `type`: `"think-start"`; \} \| \{ `result`: [`StepResult`](../interfaces/StepResult.md); `stepNumber`: `number`; `type`: `"think-complete"`; \} \| \{ `stepNumber`: `number`; `toolCalls`: [`ToolCall`](../interfaces/ToolCall.md)[]; `type`: `"act-start"`; \} \| \{ `results`: [`ToolResult`](../interfaces/ToolResult.md)[]; `stepNumber`: `number`; `type`: `"act-complete"`; \} \| \{ `state`: [`StepState`](../interfaces/StepState.md); `stepNumber`: `number`; `type`: `"observe-start"`; \} \| \{ `shouldStop`: `boolean`; `stepNumber`: `number`; `type`: `"observe-complete"`; \} \| \{ `step`: [`AgentLoopStep`](../interfaces/AgentLoopStep.md); `type`: `"step-complete"`; \} \| \{ `result`: [`AgentResult`](../interfaces/AgentResult.md); `type`: `"loop-complete"`; \} \| \{ `error`: `Error`; `stepNumber?`: `number`; `type`: `"error"`; \}

Defined in: [agents/loop.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L108)

Events emitted during loop execution
