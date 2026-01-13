[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / evaluateFlagContext

# Function: evaluateFlagContext()

> **evaluateFlagContext**(`flag`, `userId`): [`FlagEvaluation`](../interfaces/FlagEvaluation.md)

Defined in: [workflows/context/flag.ts:164](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L164)

Evaluate a flag for a given user

Evaluation order:
1. Check flag exists (non-existent = disabled)
2. Check flag status (disabled = disabled)
3. Check traffic allocation using deterministic hash
4. Assign to branch using weighted distribution

## Parameters

### flag

The flag configuration (or undefined if not found)

[`FlagWithBranches`](../interfaces/FlagWithBranches.md) | `undefined`

### userId

`string`

The user ID for deterministic assignment

## Returns

[`FlagEvaluation`](../interfaces/FlagEvaluation.md)

The evaluation result with enabled status, variant, and optional payload
