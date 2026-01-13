[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StepStatus

# Type Alias: StepStatus

> **StepStatus** = `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"skipped"`

Defined in: [workflows/StepResultStorage.ts:21](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L21)

StepResultStorage - Stores and retrieves workflow step execution results

Provides:
- Store step results with metadata (timing, status, retry count)
- Retrieve results by step name
- Get all results with filtering
- Result persistence to Durable Object storage
- Cleanup utilities for old results

This integrates with WorkflowRuntime to provide step result caching
and inspection capabilities.
