[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / CustomerInterview

# Interface: CustomerInterview

Defined in: [workflows/context/foundation.ts:118](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L118)

Customer interview data

## Properties

### completedAt?

> `optional` **completedAt**: `Date`

Defined in: [workflows/context/foundation.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L124)

***

### customerId

> **customerId**: `string`

Defined in: [workflows/context/foundation.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L121)

***

### customerPersona

> **customerPersona**: `string`

Defined in: [workflows/context/foundation.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L122)

***

### hypothesisId

> **hypothesisId**: `string`

Defined in: [workflows/context/foundation.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L120)

***

### id

> **id**: `string`

Defined in: [workflows/context/foundation.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L119)

***

### insights?

> `optional` **insights**: `string`[]

Defined in: [workflows/context/foundation.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L131)

AI-generated insights

***

### questions

> **questions**: [`InterviewQuestion`](InterviewQuestion.md)[]

Defined in: [workflows/context/foundation.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L127)

Pre-defined interview questions

***

### responses?

> `optional` **responses**: [`InterviewResponse`](InterviewResponse.md)[]

Defined in: [workflows/context/foundation.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L129)

Interview responses

***

### scheduledAt

> **scheduledAt**: `Date`

Defined in: [workflows/context/foundation.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L123)

***

### status

> **status**: `"completed"` \| `"scheduled"` \| `"in_progress"` \| `"cancelled"` \| `"no_show"`

Defined in: [workflows/context/foundation.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L125)

***

### tags

> **tags**: `string`[]

Defined in: [workflows/context/foundation.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L133)

Tags for categorization
