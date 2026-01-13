[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / VoiceConfig

# Interface: VoiceConfig

Defined in: [agents/types.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L268)

## Properties

### bargeIn?

> `optional` **bargeIn**: `boolean`

Defined in: [agents/types.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L276)

Allow user to interrupt

***

### silenceTimeoutMs?

> `optional` **silenceTimeoutMs**: `number`

Defined in: [agents/types.ts:278](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L278)

Silence threshold before turn ends

***

### transcriber

> **transcriber**: [`TranscriberConfig`](TranscriberConfig.md)

Defined in: [agents/types.ts:270](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L270)

Speech-to-text provider

***

### vad?

> `optional` **vad**: [`VADConfig`](VADConfig.md)

Defined in: [agents/types.ts:274](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L274)

Voice activity detection

***

### voice

> **voice**: [`TTSConfig`](TTSConfig.md)

Defined in: [agents/types.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L272)

Text-to-speech provider
