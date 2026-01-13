[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / SpecSchema

# Variable: SpecSchema

> `const` **SpecSchema**: `ZodObject`\<\{ `acceptanceCriteria`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `cost`: `ZodOptional`\<`ZodNumber`\>; `dependencies`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `features`: `ZodArray`\<`ZodString`\>; `priority`: `ZodOptional`\<`ZodEnum`\<\{ `high`: `"high"`; `low`: `"low"`; `medium`: `"medium"`; \}\>\>; `timeline`: `ZodString`; \}, `$strip`\>

Defined in: [agents/typed-result.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L200)

Common schema for product specifications (Priya)
