[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / FinancialAnalysisSchema

# Variable: FinancialAnalysisSchema

> `const` **FinancialAnalysisSchema**: `ZodObject`\<\{ `breakdown`: `ZodArray`\<`ZodObject`\<\{ `amount`: `ZodNumber`; `category`: `ZodString`; `notes`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>\>; `recommendations`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `risks`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `roi`: `ZodOptional`\<`ZodNumber`\>; `timeline`: `ZodOptional`\<`ZodString`\>; `totalCost`: `ZodNumber`; \}, `$strip`\>

Defined in: [agents/typed-result.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L276)

Common schema for financial analysis (Finn)
