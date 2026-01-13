[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExperimentSchema

# Variable: ExperimentSchema

> `const` **ExperimentSchema**: `ZodObject`\<\{ `branches`: `ZodArray`\<`ZodString`\>; `createdAt`: `ZodOptional`\<`ZodDate`\>; `id`: `ZodString`; `metric`: `ZodString`; `status`: `ZodEnum`\<\{ `completed`: `"completed"`; `draft`: `"draft"`; `running`: `"running"`; \}\>; `thing`: `ZodString`; `traffic`: `ZodNumber`; `updatedAt`: `ZodOptional`\<`ZodDate`\>; `winner`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>

Defined in: [types/Experiment.ts:48](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L48)

Zod schema for Experiment validation

Validates:
- traffic is between 0 and 1
- status is one of the allowed values
- branches is a non-empty array (minimum 2 for valid experiments)
- thing and metric are non-empty strings
