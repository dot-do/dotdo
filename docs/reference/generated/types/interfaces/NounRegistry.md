[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / NounRegistry

# Interface: NounRegistry

Defined in: [types/WorkflowContext.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L117)

NounRegistry - Interface for registering domain nouns with typed payloads

This interface is designed for module augmentation. Extend it in your
domain code to register nouns with their entity shapes.

## Example

```typescript
// In your domain types:
declare module '../types/WorkflowContext' {
  interface NounRegistry {
    Customer: { id: string; email: string; name: string }
    Invoice: { id: string; amount: number; status: string }
    Order: { id: string; items: string[]; total: number }
  }
}
```

After registration, $.Customer, $.Invoice, $.Order will be properly typed
and provide autocomplete. Accessing unregistered nouns will be a type error.

## Properties

### Customer

> **Customer**: `unknown`

Defined in: [types/WorkflowContext.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L119)

***

### Invoice

> **Invoice**: `unknown`

Defined in: [types/WorkflowContext.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L120)

***

### Order

> **Order**: `unknown`

Defined in: [types/WorkflowContext.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L121)

***

### Payment

> **Payment**: `unknown`

Defined in: [types/WorkflowContext.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L122)

***

### Startup

> **Startup**: `unknown`

Defined in: [types/WorkflowContext.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L123)

***

### User

> **User**: `unknown`

Defined in: [types/WorkflowContext.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L124)
