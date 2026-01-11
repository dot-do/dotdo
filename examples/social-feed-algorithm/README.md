# Social Feed Algorithm

**Your algorithm. Your data. Edge-native.**

Build personalized content feeds that run at the edge with zero cold starts. No centralized ML infrastructure. No data leaving user regions. Just fast, private, personalized ranking.

```typescript
import { Feed } from './src'

// Get personalized feed for user
const feed = await Feed('user-123').getFeed({ limit: 20 })

// Feed items ranked by:
// - Engagement signals (likes, shares, time spent)
// - Content freshness with decay
// - Social graph influence (friends' activity)
// - Interest vector matching
// Result: ~15ms p99 latency from 300+ edge locations
```

## How It Works

### Edge-Native ML Ranking

Every user gets their own Durable Object running personalized ranking. No centralized inference servers. No cold starts. The algorithm runs where your users are.

```
User Request (Tokyo)
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  Edge Location (Tokyo)                               │
│  ┌─────────────────────────────────────────────────┐ │
│  │  FeedDO (user-123)                              │ │
│  │  ├─ Interest Vector [0.8, 0.2, 0.6, ...]       │ │
│  │  ├─ Engagement History                          │ │
│  │  ├─ Social Graph Cache                          │ │
│  │  └─ Cached Feed (5min TTL)                      │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
       │
       ▼
  Ranked Feed (~15ms)
```

### The Ranking Formula

```typescript
score = (
  baseScore * freshnessDecay(age) +
  engagementBoost(likes, shares, comments) +
  socialBoost(friendsEngaged) +
  interestMatch(userVector, contentVector)
) * diversityPenalty(recentlyShown)
```

| Factor | Weight | Description |
|--------|--------|-------------|
| Freshness | 0.3 | Exponential decay over 24 hours |
| Engagement | 0.25 | Normalized likes/shares/comments |
| Social Graph | 0.25 | Friends' engagement weighted by closeness |
| Interest Match | 0.2 | Cosine similarity with user vector |

### Real-Time Updates

WebSocket connections for live feed updates:

```typescript
// Client connects to their feed DO
const ws = new WebSocket('wss://feed.example.com/ws/user-123')

ws.onmessage = (event) => {
  const update = JSON.parse(event.data)

  if (update.type === 'new_content') {
    // New high-score content added
    prependToFeed(update.item)
  }

  if (update.type === 'engagement_update') {
    // Friend engaged with content, re-rank
    updateItemScore(update.itemId, update.newScore)
  }
}
```

### A/B Testing Algorithms

Test different ranking approaches per user cohort:

```typescript
// Assign users to algorithm variants
const variant = await Feed(userId).getVariant()

// Variants defined in config
const variants = {
  control: { freshnessWeight: 0.3, socialWeight: 0.25 },
  high_social: { freshnessWeight: 0.2, socialWeight: 0.4 },
  chronological: { freshnessWeight: 1.0, socialWeight: 0 },
}

// Track engagement metrics per variant
await Feed(userId).trackEngagement({
  itemId: 'post-456',
  action: 'like',
  dwellTime: 4500, // ms spent viewing
})
```

## Features

- **Per-User Ranking** - Each user's feed runs in their own DO
- **Edge Execution** - Ranking happens in 300+ cities worldwide
- **SQLite Storage** - Engagement history persisted in DO
- **Real-Time Sync** - WebSocket updates for live content
- **Privacy First** - User data never leaves their region
- **A/B Testing** - Test algorithms with cohort assignment

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to edge
npm run deploy
```

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/feed/:userId` | GET | Get ranked feed |
| `/feed/:userId/refresh` | POST | Force refresh |
| `/feed/:userId/signals` | POST | Record engagement |
| `/feed/:userId/interests` | PUT | Update interest vector |
| `/ws/:userId` | WebSocket | Real-time updates |

### Feed Parameters

```typescript
interface FeedParams {
  limit?: number       // Items to return (default: 20)
  offset?: number      // Pagination offset
  refresh?: boolean    // Bypass cache
  variant?: string     // Force algorithm variant
}
```

## Architecture

```
src/
├── index.ts          # Hono app + FeedDO export
├── FeedDO.ts         # Durable Object with ranking logic
├── ranking.ts        # Scoring algorithms
├── signals.ts        # Engagement signal processing
└── vectors.ts        # Interest vector operations
```

## Built With

- [dotdo](https://dotdo.dev) - Edge-native Durable Objects framework
- [Hono](https://hono.dev) - Fast web framework
- SQLite (via DO) - Persistent engagement storage
