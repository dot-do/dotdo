[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CapabilityModule

# Interface: CapabilityModule

Defined in: [types/capabilities.ts:36](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L36)

Base interface for all capability modules.

Capability modules are lazy-loaded and cached on first access.
They provide domain-specific functionality to workflows.

## Example

```typescript
class MyCapability implements CapabilityModule {
  readonly name = 'my-capability'

  async initialize(): Promise<void> {
    // Setup code
  }

  async dispose(): Promise<void> {
    // Cleanup code
  }
}
```

## Extended by

- [`FsCapability`](FsCapability.md)
- [`GitCapability`](GitCapability.md)
- [`BashCapability`](BashCapability.md)

## Methods

### dispose()?

> `optional` **dispose**(): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L52)

Optional cleanup hook called when the capability is unloaded.
Use for releasing resources, closing connections, etc.

#### Returns

`Promise`\<`void`\>

***

### initialize()?

> `optional` **initialize**(): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L46)

Optional initialization hook called when the module is first loaded.
Use for async setup operations.

#### Returns

`Promise`\<`void`\>

## Properties

### name

> `readonly` **name**: `string`

Defined in: [types/capabilities.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L40)

Unique identifier for this capability module
