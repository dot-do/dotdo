# @dotdo/ai

AI routing layer for dotdo. Template literals and multi-provider support.

## Usage

```typescript
import { ai } from '@dotdo/ai'

const result = await ai`Summarize this: ${text}`
  .with({ model: 'claude-3-opus' })

console.log(result.$meta.tokens)
```

## Status

See beads issues do-7rf.5.* for implementation progress.
