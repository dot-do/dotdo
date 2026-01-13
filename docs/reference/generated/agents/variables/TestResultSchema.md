[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / TestResultSchema

# Variable: TestResultSchema

> `const` **TestResultSchema**: `ZodObject`\<\{ `coverage`: `ZodOptional`\<`ZodNumber`\>; `passed`: `ZodBoolean`; `summary`: `ZodOptional`\<`ZodString`\>; `testCases`: `ZodArray`\<`ZodObject`\<\{ `duration`: `ZodOptional`\<`ZodNumber`\>; `error`: `ZodOptional`\<`ZodString`\>; `name`: `ZodString`; `status`: `ZodEnum`\<\{ `fail`: `"fail"`; `pass`: `"pass"`; `skip`: `"skip"`; \}\>; \}, `$strip`\>\>; \}, `$strip`\>

Defined in: [agents/typed-result.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L245)

Common schema for test results (Quinn)
