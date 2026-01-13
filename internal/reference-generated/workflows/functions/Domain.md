[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / Domain

# Function: Domain()

> **Domain**(`name`, `handlers`): `DomainCallable`

Defined in: [workflows/on.ts:889](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L889)

Factory for creating callable domain objects.

Domains encapsulate related business logic and can be invoked directly
in workflow expressions. They integrate with the pipeline promise system
for deferred execution and promise pipelining.

## Parameters

### name

`string`

Unique identifier for the domain

### handlers

`Record`\<`string`, `Function`\>

Object mapping method names to handler functions

## Returns

`DomainCallable`

A callable domain object that creates pipeline expressions

## Examples

```typescript
const CRM = Domain('CRM', {
  createAccount: (customer) => ({
    id: generateId(),
    ...customer,
    createdAt: new Date()
  }),
  sendWelcome: (account) => {
    return sendEmail({
      to: account.email,
      template: 'welcome'
    })
  }
})
```

```typescript
// Direct invocation returns PipelinePromise
const account = CRM(customer).createAccount()
const emailResult = CRM(account).sendWelcome()

// Can be awaited when needed
const result = await account
```

```typescript
const Inventory = Domain('Inventory', {
  check: (product) => getStock(product.id),
  reserve: (product, quantity) => reserveStock(product.id, quantity),
  release: (reservation) => releaseStock(reservation.id)
})

const Shipping = Domain('Shipping', {
  calculate: (order) => calculateRates(order),
  create: (order, rate) => createShipment(order, rate)
})

// Compose domains in workflows
async function fulfillOrder(order: Order) {
  const stock = await Inventory(order.product).check()
  if (stock.available >= order.quantity) {
    const reservation = await Inventory(order.product).reserve(order.quantity)
    const rates = await Shipping(order).calculate()
    return Shipping(order).create(rates[0])
  }
}
```
