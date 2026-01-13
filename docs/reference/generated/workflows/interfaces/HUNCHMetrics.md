[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / HUNCHMetrics

# Interface: HUNCHMetrics

Defined in: [workflows/context/foundation.ts:154](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L154)

HUNCH metrics baseline
Hair-on-fire, Usage, NPS, Churn, LTV/CAC

## Properties

### churn

> **churn**: `object`

Defined in: [workflows/context/foundation.ts:192](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L192)

Churn: Customer retention

#### annualRate

> **annualRate**: `number`

Annual churn rate (percentage)

#### avgLifetimeMonths

> **avgLifetimeMonths**: `number`

Average customer lifetime (months)

#### cohortRetention

> **cohortRetention**: `Record`\<`string`, `number`\>

Churn by cohort

#### monthlyRate

> **monthlyRate**: `number`

Monthly churn rate (percentage)

***

### hairOnFire

> **hairOnFire**: `object`

Defined in: [workflows/context/foundation.ts:156](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L156)

Hair-on-fire: Is this an urgent, critical problem?

#### activelySearching

> **activelySearching**: `boolean`

Would they actively search for a solution?

#### painLevel

> **painLevel**: `number`

Average pain level (1-10)

#### urgencyScore

> **urgencyScore**: `number`

Percentage of customers who describe problem as "must fix now"

***

### ltvCac

> **ltvCac**: `object`

Defined in: [workflows/context/foundation.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L204)

LTV/CAC: Unit economics

#### cac

> **cac**: `number`

Customer acquisition cost ($)

#### ltv

> **ltv**: `number`

Lifetime value ($)

#### paybackMonths

> **paybackMonths**: `number`

Months to recover CAC

#### ratio

> **ratio**: `number`

LTV/CAC ratio

***

### nps

> **nps**: `object`

Defined in: [workflows/context/foundation.ts:178](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L178)

NPS: Net Promoter Score

#### detractors

> **detractors**: `number`

Percentage of detractors (0-6)

#### passives

> **passives**: `number`

Percentage of passives (7-8)

#### promoters

> **promoters**: `number`

Percentage of promoters (9-10)

#### responseCount

> **responseCount**: `number`

Number of responses

#### score

> **score**: `number`

NPS score (-100 to 100)

***

### usage

> **usage**: `object`

Defined in: [workflows/context/foundation.ts:166](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L166)

Usage: How often do they engage?

#### avgSessionDuration

> **avgSessionDuration**: `number`

Average session duration (minutes)

#### dauMau

> **dauMau**: `number`

Daily active users / Monthly active users

#### featureAdoption

> **featureAdoption**: `Record`\<`string`, `number`\>

Feature adoption rates

#### sessionsPerWeek

> **sessionsPerWeek**: `number`

Average sessions per week
