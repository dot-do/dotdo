[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / DataAnalysisSchema

# Variable: DataAnalysisSchema

> `const` **DataAnalysisSchema**: `ZodObject`\<\{ `insights`: `ZodArray`\<`ZodObject`\<\{ `confidence`: `ZodOptional`\<`ZodNumber`\>; `finding`: `ZodString`; `impact`: `ZodOptional`\<`ZodEnum`\<\{ `high`: `"high"`; `low`: `"low"`; `medium`: `"medium"`; \}\>\>; \}, `$strip`\>\>; `metrics`: `ZodOptional`\<`ZodRecord`\<`ZodNumber`, `SomeType`\>\>; `recommendations`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `trends`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `visualization`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>

Defined in: [agents/typed-result.ts:294](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L294)

Common schema for data analysis (Dana)
