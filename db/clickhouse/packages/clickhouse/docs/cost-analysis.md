# Cost Analysis: ClickHouse Deployment Options

## Overview

This document compares the cost characteristics of different chdb/ClickHouse deployment options on Cloudflare.

## Deployment Options

### 1. Cloudflare Workers (WASM)

**Pricing Model:** Pay-per-request
- Free tier: 100,000 requests/day
- Paid: $0.50 per million requests
- CPU time: 10ms free, then $0.02 per million ms

**Best for:**
- Low-volume analytics (<100K queries/day)
- Simple queries with small result sets
- Global edge deployment

**Cost Example:**
- 1M queries/month = ~$0.50
- If avg CPU time 50ms: additional ~$1.00

### 2. Durable Objects (WASM)

**Pricing Model:** Wall-clock time + requests
- $0.15 per million requests
- $12.50 per million GB-seconds (wall-clock)

**Best for:**
- Stateful analytics with caching
- Warm WASM instances (amortized init cost)
- Session-based queries

### 3. Cloudflare Containers (Sandbox)

**Pricing Model:** Container runtime
- Based on vCPU-seconds and memory
- More cost-effective for sustained workloads

**Best for:**
- Complex queries
- Large datasets
- High query volume

### 4. Full ClickHouse (Container)

**Pricing Model:** Container runtime + storage
- Similar to Sandbox but with persistent storage
- R2 storage costs for data

**Best for:**
- Production analytics
- Large-scale data processing
- Full SQL compatibility

## Cost Comparison Table

| Scenario | Workers | DO | Sandbox | Full CH |
|----------|---------|-----|---------|---------|
| 10K queries/day | Free | ~$1 | ~$5 | ~$10 |
| 100K queries/day | ~$1.5 | ~$10 | ~$15 | ~$25 |
| 1M queries/day | ~$15 | ~$100 | ~$50 | ~$100 |

## Recommendations

1. **Start with Workers** for prototyping and low volume
2. **Use Durable Objects** for stateful caching scenarios
3. **Upgrade to Sandbox** when query complexity increases
4. **Deploy Full ClickHouse** for production workloads
