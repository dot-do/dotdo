[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ReviewSchema

# Variable: ReviewSchema

> `const` **ReviewSchema**: `ZodObject`\<\{ `approved`: `ZodBoolean`; `issues`: `ZodArray`\<`ZodObject`\<\{ `file`: `ZodOptional`\<`ZodString`\>; `line`: `ZodOptional`\<`ZodNumber`\>; `message`: `ZodString`; `severity`: `ZodEnum`\<\{ `error`: `"error"`; `info`: `"info"`; `warning`: `"warning"`; \}\>; `suggestion`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>\>; `score`: `ZodOptional`\<`ZodNumber`\>; `suggestions`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; \}, `$strip`\>

Defined in: [agents/typed-result.ts:214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L214)

Common schema for code review results (Tom)
