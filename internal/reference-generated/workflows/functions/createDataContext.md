[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createDataContext

# Function: createDataContext()

> **createDataContext**(): [`FullDataContext`](../interfaces/FullDataContext.md)

Defined in: workflows/data/index.ts:822

Create a full data context with all namespaces

This provides the unified $ data API with:
- $.data - Basic CRUD and query primitives
- $.track - Event tracking and analytics
- $.measure - Time-series metrics
- $.experiment - A/B testing
- $.goal - OKR tracking
- $.stream - Real-time streams
- $.view - Materialized views
- $.Entity(id) - Event sourcing

## Returns

[`FullDataContext`](../interfaces/FullDataContext.md)

Full data context with all namespaces
