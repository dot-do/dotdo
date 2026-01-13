[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / LLMSummarizerOptions

# Interface: LLMSummarizerOptions

Defined in: [agents/memory.ts:609](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L609)

Create a summarizer that uses an LLM to generate summaries

## Example

```ts
const summarizer = createLLMSummarizer(agent, {
  maxSummaryTokens: 500,
})
memory.setSummarizer(summarizer)
```

## Properties

### maxSummaryTokens?

> `optional` **maxSummaryTokens**: `number`

Defined in: [agents/memory.ts:611](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L611)

Maximum tokens for the generated summary

***

### systemPrompt?

> `optional` **systemPrompt**: `string`

Defined in: [agents/memory.ts:613](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L613)

Custom system prompt for summarization
