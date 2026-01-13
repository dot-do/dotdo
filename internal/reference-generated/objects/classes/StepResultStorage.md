[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StepResultStorage

# Class: StepResultStorage

Defined in: [workflows/StepResultStorage.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L157)

## Constructors

### Constructor

> **new StepResultStorage**(`state`): `StepResultStorage`

Defined in: [workflows/StepResultStorage.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L160)

#### Parameters

##### state

`DurableObjectState`

#### Returns

`StepResultStorage`

## Methods

### clear()

> **clear**(`stepName`): `Promise`\<`void`\>

Defined in: [workflows/StepResultStorage.ts:296](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L296)

Clear a specific step result

#### Parameters

##### stepName

`string`

#### Returns

`Promise`\<`void`\>

***

### clearAll()

> **clearAll**(): `Promise`\<`void`\>

Defined in: [workflows/StepResultStorage.ts:303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L303)

Clear all step results

#### Returns

`Promise`\<`void`\>

***

### clearByStatus()

> **clearByStatus**(`status`): `Promise`\<`number`\>

Defined in: [workflows/StepResultStorage.ts:338](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L338)

Clear results by status

#### Parameters

##### status

[`StepStatus`](../type-aliases/StepStatus.md)

#### Returns

`Promise`\<`number`\>

***

### clearOlderThan()

> **clearOlderThan**(`maxAge`): `Promise`\<`number`\>

Defined in: [workflows/StepResultStorage.ts:316](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L316)

Clear results older than specified duration

#### Parameters

##### maxAge

Duration string (e.g., "1 hour", "30 minutes") or milliseconds

`string` | `number`

#### Returns

`Promise`\<`number`\>

***

### get()

> **get**(`stepName`): `Promise`\<[`StoredStepResult`](../interfaces/StoredStepResult.md) \| `undefined`\>

Defined in: [workflows/StepResultStorage.ts:195](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L195)

Retrieve a step result by name

#### Parameters

##### stepName

`string`

#### Returns

`Promise`\<[`StoredStepResult`](../interfaces/StoredStepResult.md) \| `undefined`\>

***

### getAll()

> **getAll**(`options`): `Promise`\<[`StoredStepResult`](../interfaces/StoredStepResult.md)[]\>

Defined in: [workflows/StepResultStorage.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L227)

Get all stored step results with optional filtering

#### Parameters

##### options

[`GetAllOptions`](../interfaces/GetAllOptions.md) = `{}`

#### Returns

`Promise`\<[`StoredStepResult`](../interfaces/StoredStepResult.md)[]\>

***

### getStepResult()

> **getStepResult**(`stepName`): `Promise`\<[`StoredStepResult`](../interfaces/StoredStepResult.md) \| `undefined`\>

Defined in: [workflows/StepResultStorage.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L208)

Alias for get - convenience method for WorkflowRuntime integration

#### Parameters

##### stepName

`string`

#### Returns

`Promise`\<[`StoredStepResult`](../interfaces/StoredStepResult.md) \| `undefined`\>

***

### getSummary()

> **getSummary**(): `Promise`\<[`ResultSummary`](../interfaces/ResultSummary.md)\>

Defined in: [workflows/StepResultStorage.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L261)

Get a summary of all step results

#### Returns

`Promise`\<[`ResultSummary`](../interfaces/ResultSummary.md)\>

***

### hasResult()

> **hasResult**(`stepName`): `Promise`\<`boolean`\>

Defined in: [workflows/StepResultStorage.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L215)

Check if a step has a stored result

#### Parameters

##### stepName

`string`

#### Returns

`Promise`\<`boolean`\>

***

### store()

> **store**(`stepName`, `result`): `Promise`\<`void`\>

Defined in: [workflows/StepResultStorage.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L171)

Store a step result with metadata

#### Parameters

##### stepName

`string`

##### result

[`StepResultInput`](../interfaces/StepResultInput.md)

#### Returns

`Promise`\<`void`\>
