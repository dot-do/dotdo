[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BudgetExceededError

# Class: BudgetExceededError

Defined in: [agents/cost-tracker.ts:219](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L219)

Error thrown when budget is exceeded with hardLimit enabled

## Extends

- `Error`

## Constructors

### Constructor

> **new BudgetExceededError**(`currentCost`, `maxCost`, `trackerId?`): `BudgetExceededError`

Defined in: [agents/cost-tracker.ts:224](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L224)

#### Parameters

##### currentCost

`number`

##### maxCost

`number`

##### trackerId?

`string`

#### Returns

`BudgetExceededError`

#### Overrides

`Error.constructor`

## Properties

### currentCost

> `readonly` **currentCost**: `number`

Defined in: [agents/cost-tracker.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L220)

***

### maxCost

> `readonly` **maxCost**: `number`

Defined in: [agents/cost-tracker.ts:221](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L221)

***

### trackerId?

> `readonly` `optional` **trackerId**: `string`

Defined in: [agents/cost-tracker.ts:222](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L222)
