[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MemoryType

# Type Alias: MemoryType

> **MemoryType** = `"short-term"` \| `"long-term"` \| `"episodic"` \| `"semantic"`

Defined in: [agents/unified-memory.ts:33](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L33)

Memory type classification
- short-term: Temporary context, may be pruned aggressively
- long-term: Important facts to preserve across sessions
- episodic: Event/action memories with temporal context
- semantic: Extracted facts and knowledge
