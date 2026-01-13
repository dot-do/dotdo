[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StepDOBridge

# Class: StepDOBridge

Defined in: [workflows/StepDOBridge.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L85)

## Constructors

### Constructor

> **new StepDOBridge**(`namespaces`): `StepDOBridge`

Defined in: [workflows/StepDOBridge.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L102)

Create a new StepDOBridge with DO namespace bindings.

#### Parameters

##### namespaces

`Record`\<`string`, [`DONamespaceBinding`](../interfaces/DONamespaceBinding.md)\>

Map of noun names to DurableObjectNamespace bindings

#### Returns

`StepDOBridge`

#### Example

```typescript
const bridge = new StepDOBridge({
  Users: env.USERS,
  Orders: env.ORDERS,
  Notifications: env.NOTIFICATIONS,
})
```

## Methods

### createProxy()

> **createProxy**(): [`DomainProxy`](../interfaces/DomainProxy.md)

Defined in: [workflows/StepDOBridge.ts:118](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L118)

Create a domain proxy for use in workflow step context.
Returns a proxy that supports $.Noun(id).method(...args) style calls.

#### Returns

[`DomainProxy`](../interfaces/DomainProxy.md)

Domain proxy object

#### Example

```typescript
const $ = bridge.createProxy()
const user = await $.Users('user-123').create({ name: 'John' })
```
