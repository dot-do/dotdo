[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / collectStreamEvents

# Function: collectStreamEvents()

> **collectStreamEvents**(`stream`): `Promise`\<\{ `events`: [`StreamEvent`](../interfaces/StreamEvent.md)[]; `textDeltas`: `string`[]; `toolCalls`: [`ToolCall`](../interfaces/ToolCall.md)[]; \}\>

Defined in: [agents/testing.ts:678](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L678)

Wait for a stream to complete and collect all events

## Parameters

### stream

`AsyncIterable`\<[`StreamEvent`](../interfaces/StreamEvent.md)\>

## Returns

`Promise`\<\{ `events`: [`StreamEvent`](../interfaces/StreamEvent.md)[]; `textDeltas`: `string`[]; `toolCalls`: [`ToolCall`](../interfaces/ToolCall.md)[]; \}\>
