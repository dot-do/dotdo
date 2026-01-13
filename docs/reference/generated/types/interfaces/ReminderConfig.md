[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ReminderConfig

# Interface: ReminderConfig

Defined in: [types/AIFunction.ts:301](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L301)

Reminder configuration for human tasks

## Properties

### channel?

> `optional` **channel**: `"webhook"` \| `"web"` \| `"email"` \| `"sms"` \| `"slack"`

Defined in: [types/AIFunction.ts:309](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L309)

Channel override for this reminder

***

### date?

> `optional` **date**: `string` \| `Date`

Defined in: [types/AIFunction.ts:307](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L307)

Specific date for 'on_date' timing

***

### duration?

> `optional` **duration**: `string`

Defined in: [types/AIFunction.ts:305](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L305)

Duration in ISO 8601 format (e.g., 'P1D' for 1 day)

***

### timing

> **timing**: `"before_due"` \| `"after_creation"` \| `"on_date"`

Defined in: [types/AIFunction.ts:303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L303)

When to send the reminder (relative to creation or due date)
