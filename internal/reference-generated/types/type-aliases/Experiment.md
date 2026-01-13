[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Experiment

# Type Alias: Experiment

> **Experiment** = `ZodObject`\<\{ `branches`: `ZodArray`\<`ZodString`\>; `createdAt`: `ZodOptional`\<`ZodDate`\>; `id`: `ZodString`; `metric`: `ZodString`; `status`: `ZodEnum`\<\{ `completed`: `"completed"`; `draft`: `"draft"`; `running`: `"running"`; \}\>; `thing`: `ZodString`; `traffic`: `ZodNumber`; `updatedAt`: `ZodOptional`\<`ZodDate`\>; `winner`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>

Defined in: [types/Experiment.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L23)

Runtime Experiment type marker
Used for dynamic imports and runtime type identification
