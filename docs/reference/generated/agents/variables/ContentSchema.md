[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ContentSchema

# Variable: ContentSchema

> `const` **ContentSchema**: `ZodObject`\<\{ `body`: `ZodString`; `callToAction`: `ZodOptional`\<`ZodString`\>; `keywords`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `summary`: `ZodOptional`\<`ZodString`\>; `title`: `ZodString`; `tone`: `ZodOptional`\<`ZodEnum`\<\{ `casual`: `"casual"`; `friendly`: `"friendly"`; `professional`: `"professional"`; `technical`: `"technical"`; \}\>\>; \}, `$strip`\>

Defined in: [agents/typed-result.ts:262](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L262)

Common schema for marketing content (Mark)
