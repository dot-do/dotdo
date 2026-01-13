[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Stickiness

# Type Alias: Stickiness

> **Stickiness** = `"user_id"` \| `"session_id"` \| `"random"`

Defined in: [types/Flag.ts:34](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L34)

Stickiness determines how users are assigned to branches
- user_id: Consistent per user across sessions
- session_id: Consistent within a session
- random: Random assignment on each evaluation
