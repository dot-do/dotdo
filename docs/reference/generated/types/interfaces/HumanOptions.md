[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HumanOptions

# Interface: HumanOptions

Defined in: [types/AIFunction.ts:225](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L225)

Options for human-in-the-loop execution
Waits for human input/approval

## Extends

- [`BaseExecutorOptions`](BaseExecutorOptions.md)

## Properties

### assignee?

> `optional` **assignee**: `string` \| `string`[]

Defined in: [types/AIFunction.ts:229](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L229)

User or group to notify

***

### cache?

> `optional` **cache**: `boolean` \| [`CacheConfig`](CacheConfig.md)

Defined in: [types/AIFunction.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L151)

Whether to cache results

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`cache`](BaseExecutorOptions.md#cache)

***

### channel?

> `optional` **channel**: `"webhook"` \| `"web"` \| `"email"` \| `"sms"` \| `"slack"`

Defined in: [types/AIFunction.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L227)

Communication channel (email, slack, sms, web)

***

### dueDate?

> `optional` **dueDate**: `string` \| `Date`

Defined in: [types/AIFunction.ts:233](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L233)

Due date for the task

***

### escalation?

> `optional` **escalation**: [`EscalationConfig`](EscalationConfig.md)

Defined in: [types/AIFunction.ts:237](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L237)

Escalation rules

***

### formSchema?

> `optional` **formSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:241](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L241)

UI form schema for structured input

***

### instructions?

> `optional` **instructions**: `string`

Defined in: [types/AIFunction.ts:243](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L243)

Instructions for the human

***

### priority?

> `optional` **priority**: `"low"` \| `"medium"` \| `"high"` \| `"urgent"`

Defined in: [types/AIFunction.ts:231](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L231)

Priority level

***

### reminders?

> `optional` **reminders**: [`ReminderConfig`](ReminderConfig.md)[]

Defined in: [types/AIFunction.ts:235](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L235)

Reminder intervals

***

### requiresApproval?

> `optional` **requiresApproval**: `boolean`

Defined in: [types/AIFunction.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L245)

Whether approval is required (vs informational)

***

### retry?

> `optional` **retry**: [`RetryConfig`](RetryConfig.md)

Defined in: [types/AIFunction.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L149)

Retry configuration

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`retry`](BaseExecutorOptions.md#retry)

***

### tags?

> `optional` **tags**: `Record`\<`string`, `string`\>

Defined in: [types/AIFunction.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L153)

Tags for metrics/logging

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`tags`](BaseExecutorOptions.md#tags)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/AIFunction.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L147)

Execution timeout in milliseconds

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`timeout`](BaseExecutorOptions.md#timeout)

***

### webhookUrl?

> `optional` **webhookUrl**: `string`

Defined in: [types/AIFunction.ts:239](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L239)

Custom webhook for receiving responses
