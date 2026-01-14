[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / isPipelinePromise

# Function: isPipelinePromise()

> **isPipelinePromise**(`value`): `value is PipelinePromise<unknown>`

Defined in: [workflows/pipeline-promise.ts:177](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L177)

Type guard to check if a value is a PipelinePromise.

Use this to determine if a value was created by the pipeline system
and contains a captured expression for deferred execution.

## Parameters

### value

`unknown`

The value to check

## Returns

`value is PipelinePromise<unknown>`

true if the value is a PipelinePromise

## Example

```typescript
const user = $.User(id).get()
const plainValue = { name: 'John' }

isPipelinePromise(user)       // true
isPipelinePromise(plainValue) // false

// Use for conditional handling
function processValue(val: unknown) {
  if (isPipelinePromise(val)) {
    console.log('Expression:', val.__expr)
  } else {
    console.log('Literal:', val)
  }
}
```
