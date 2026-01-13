[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EnhancedDispatchResult

# Interface: EnhancedDispatchResult

Defined in: [types/WorkflowContext.ts:582](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L582)

Enhanced dispatch result with additional metadata

## Properties

### dlqEntries

> **dlqEntries**: `string`[]

Defined in: [types/WorkflowContext.ts:588](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L588)

IDs of DLQ entries created for failed handlers

***

### errors

> **errors**: `Error`[]

Defined in: [types/WorkflowContext.ts:586](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L586)

Array of errors from failed handlers

***

### filtered

> **filtered**: `number`

Defined in: [types/WorkflowContext.ts:590](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L590)

Number of handlers skipped due to filter predicate

***

### handled

> **handled**: `number`

Defined in: [types/WorkflowContext.ts:584](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L584)

Number of handlers that executed successfully

***

### wildcardMatches

> **wildcardMatches**: `number`

Defined in: [types/WorkflowContext.ts:592](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L592)

Number of wildcard handler matches
