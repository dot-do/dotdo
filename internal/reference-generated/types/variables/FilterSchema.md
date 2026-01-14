[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / FilterSchema

# Variable: FilterSchema

> `const` **FilterSchema**: `ZodObject`\<\{ `cohortId`: `ZodOptional`\<`ZodString`\>; `operator`: `ZodOptional`\<`ZodEnum`\<\{ `contains`: `"contains"`; `eq`: `"eq"`; `gt`: `"gt"`; `in`: `"in"`; `lt`: `"lt"`; \}\>\>; `property`: `ZodOptional`\<`ZodString`\>; `type`: `ZodEnum`\<\{ `cohort`: `"cohort"`; `property`: `"property"`; \}\>; `value`: `ZodOptional`\<`ZodUnknown`\>; \}, `$strict`\>

Defined in: [types/Flag.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L78)

Zod schema for Filter validation
