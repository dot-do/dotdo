[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationInterviewBuilder

# Interface: FoundationInterviewBuilder

Defined in: [workflows/context/foundation.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L335)

Interview builder - for scheduling/conducting interviews

## Methods

### complete()

> **complete**(): `Promise`\<[`CustomerInterview`](CustomerInterview.md)\>

Defined in: [workflows/context/foundation.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L347)

Complete and analyze interview

#### Returns

`Promise`\<[`CustomerInterview`](CustomerInterview.md)\>

***

### generateQuestions()

> **generateQuestions**(): `Promise`\<`FoundationInterviewBuilder`\>

Defined in: [workflows/context/foundation.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L339)

Use AI to generate questions based on hypothesis

#### Returns

`Promise`\<`FoundationInterviewBuilder`\>

***

### questions()

> **questions**(`questions`): `this`

Defined in: [workflows/context/foundation.ts:337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L337)

Set interview questions

#### Parameters

##### questions

[`InterviewQuestion`](InterviewQuestion.md)[]

#### Returns

`this`

***

### respond()

> **respond**(`questionId`, `answer`): `this`

Defined in: [workflows/context/foundation.ts:345](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L345)

Record response

#### Parameters

##### questionId

`string`

##### answer

`string`

#### Returns

`this`

***

### schedule()

> **schedule**(`at`): `Promise`\<[`CustomerInterview`](CustomerInterview.md)\>

Defined in: [workflows/context/foundation.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L341)

Schedule interview for specific time

#### Parameters

##### at

`Date`

#### Returns

`Promise`\<[`CustomerInterview`](CustomerInterview.md)\>

***

### start()

> **start**(): `Promise`\<[`CustomerInterview`](CustomerInterview.md)\>

Defined in: [workflows/context/foundation.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L343)

Start interview now (interactive)

#### Returns

`Promise`\<[`CustomerInterview`](CustomerInterview.md)\>
