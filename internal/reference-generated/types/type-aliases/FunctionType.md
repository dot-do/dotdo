[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / FunctionType

# Type Alias: FunctionType

> **FunctionType** = `"code"` \| `"generative"` \| `"agentic"` \| `"human"`

Defined in: [types/fn.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L23)

The four implementation types for functions.
- code: Deterministic TypeScript (fastest, cheapest)
- generative: Single AI completion
- agentic: AI + tools in a loop
- human: Human-in-the-loop (slowest, most expensive)
