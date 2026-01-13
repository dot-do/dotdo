[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / VoiceSession

# Interface: VoiceSession

Defined in: [agents/providers/voice.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L37)

## Properties

### id

> **id**: `string`

Defined in: [agents/providers/voice.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L38)

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/providers/voice.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L41)

***

### status

> **status**: `"connecting"` \| `"connected"` \| `"speaking"` \| `"listening"` \| `"ended"`

Defined in: [agents/providers/voice.ts:39](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L39)

***

### transcript

> **transcript**: [`TranscriptEntry`](TranscriptEntry.md)[]

Defined in: [agents/providers/voice.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/providers/voice.ts#L40)
