[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AIBindings

# Interface: AIBindings

Defined in: [types/CloudflareBindings.ts:186](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L186)

Workers AI bindings

Provides access to Cloudflare's AI inference models including
LLMs, embeddings, image generation, and speech-to-text.

## Extended by

- [`CloudflareEnv`](CloudflareEnv.md)

## Properties

### AI?

> `optional` **AI**: `Ai`\<`AiModels`\>

Defined in: [types/CloudflareBindings.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L198)

Workers AI binding for inference

Supports models:
- Text: @cf/meta/llama-3.1-70b-instruct, @cf/meta/llama-3.1-8b-instruct
- Embeddings: @cf/baai/bge-base-en-v1.5
- Images: @cf/black-forest-labs/flux-1-schnell
- Speech: @cf/openai/whisper

#### See

https://developers.cloudflare.com/workers-ai/

***

### AI\_GATEWAY?

> `optional` **AI\_GATEWAY**: `object`

Defined in: [types/CloudflareBindings.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L216)

AI Gateway binding for unified AI access

Provides routing, caching, and observability for AI requests.

#### See

https://developers.cloudflare.com/ai-gateway/

***

### VECTORS?

> `optional` **VECTORS**: `VectorizeIndex`

Defined in: [types/CloudflareBindings.ts:207](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L207)

Vectorize index for semantic search

Provides vector similarity search for embeddings.

#### See

https://developers.cloudflare.com/vectorize/
