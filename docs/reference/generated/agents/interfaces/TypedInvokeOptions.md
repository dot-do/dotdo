[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / TypedInvokeOptions

# Interface: TypedInvokeOptions

Defined in: [agents/named/factory.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L140)

Options for typed invocation

## Properties

### allowPartial?

> `optional` **allowPartial**: `boolean`

Defined in: [agents/named/factory.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L144)

Allow partial results on parse failure (default: false)

***

### coerce?

> `optional` **coerce**: `boolean`

Defined in: [agents/named/factory.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L142)

Enable type coercion for AI output quirks (default: true)

***

### includeSchemaInPrompt?

> `optional` **includeSchemaInPrompt**: `boolean`

Defined in: [agents/named/factory.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L146)

Include JSON schema in prompt to guide AI output (default: true)
