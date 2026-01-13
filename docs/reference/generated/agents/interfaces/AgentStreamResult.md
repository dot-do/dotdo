[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentStreamResult

# Interface: AgentStreamResult

Defined in: [agents/types.ts:423](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L423)

## Extends

- `AsyncIterable`\<[`StreamEvent`](StreamEvent.md)\>

## Properties

### result

> **result**: `Promise`\<[`AgentResult`](AgentResult.md)\>

Defined in: [agents/types.ts:425](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L425)

Promise that resolves to final result

***

### text

> **text**: `Promise`\<`string`\>

Defined in: [agents/types.ts:427](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L427)

Text promise (resolves when complete)

***

### toolCalls

> **toolCalls**: `Promise`\<[`ToolCall`](ToolCall.md)[]\>

Defined in: [agents/types.ts:429](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L429)

Tool calls promise

***

### usage

> **usage**: `Promise`\<[`TokenUsage`](TokenUsage.md)\>

Defined in: [agents/types.ts:431](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L431)

Usage promise
