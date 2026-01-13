[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / NounAccessors

# Type Alias: NounAccessors

> **NounAccessors** = `{ [K in keyof NounRegistry]: (id: string) => DomainProxy }`

Defined in: [types/WorkflowContext.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L133)

NounAccessors - Mapped type providing typed noun access

Each key in NounRegistry becomes a callable (id: string) => DomainProxy
property on WorkflowContext.
