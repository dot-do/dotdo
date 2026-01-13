[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createAnalyticsContext

# Function: createAnalyticsContext()

> **createAnalyticsContext**(): [`AnalyticsContext`](../interfaces/AnalyticsContext.md)

Defined in: [workflows/context/analytics.ts:831](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L831)

Creates a mock workflow context ($) with analytics support for testing

This factory creates a context object with:
- $.analytics.web - Web traffic analytics
- $.analytics.product - Product usage analytics
- $.analytics.financial - Financial metrics
- $.analytics.all() - Get all metrics at once
- $.analytics.summary() - Get dashboard summary
- $._storage - Internal storage for test setup

## Returns

[`AnalyticsContext`](../interfaces/AnalyticsContext.md)

An AnalyticsContext object with analytics API methods
