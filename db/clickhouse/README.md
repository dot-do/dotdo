# ClickHouse Monorepo

A comprehensive monorepo for running ClickHouse and chdb across multiple deployment targets: WebAssembly (Cloudflare Workers/Durable Objects), native binaries (Cloudflare Sandbox), and full ClickHouse containers.

## Overview

This project provides a unified TypeScript API for ClickHouse-compatible analytics across:

| Environment | Package | Use Case |
|-------------|---------|----------|
| WASM (Workers/DO) | `@dotdo/chdb-wasm` | Edge queries, low-latency analytics |
| Native Sandbox | `@dotdo/chdb` | Full chdb power in Cloudflare containers |
| Full ClickHouse | `@dotdo/clickhouse` | Complete ClickHouse with S3-backed storage |

## Packages

### [`@dotdo/chdb-wasm`](./packages/chdb-wasm)

WASM-compiled chdb optimized for Cloudflare Workers and Durable Objects.

- Multiple build profiles (minimal, standard, full) for size/feature tradeoffs
- Optimized for constrained memory environments
- Streaming query support

### [`@dotdo/chdb`](./packages/chdb)

Unified chdb client supporting both WASM and native sandbox execution.

- Auto-selects optimal backend based on environment
- [capnweb](https://github.com/cloudflare/capnweb) RPC for client/server communication
- TypeScript types matching official chdb SDK

### [`@dotdo/clickhouse`](./packages/clickhouse)

Full ClickHouse deployment with R2/S3-backed scale-out architecture.

- Pre-configured Docker container with S3 table engines
- Local disk cache for remote storage
- Stateless deployment (no Keeper/ZooKeeper required)
- HTTP interface proxy (query API + web UI)
- capnweb RPC client/server

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Application                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │ capnweb RPC / HTTP
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  @dotdo/clickhouse client                       │
│         (unified API - auto-selects backend)                    │
└──────┬──────────────────┬───────────────────┬───────────────────┘
       │                  │                   │
       ▼                  ▼                   ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────────────────────┐
│ chdb-wasm   │   │ chdb        │   │ ClickHouse Container        │
│ (Workers/DO)│   │ (Sandbox)   │   │ (S3-backed, scale-out)      │
└─────────────┘   └─────────────┘   └─────────────────────────────┘
```

## Deployment Targets

### Cloudflare Workers (WASM)

- **Pros**: Global edge deployment, pay-per-request, low latency
- **Cons**: Memory limits (~128MB), CPU time limits, cold starts
- **Best for**: Simple queries, small datasets, real-time dashboards

### Cloudflare Durable Objects (WASM)

- **Pros**: Persistent state, SQLite storage, wall-clock billing
- **Cons**: Single-threaded, memory limits
- **Best for**: Stateful analytics, caching layers, write buffers
- **Note**: DO billing is wall-clock time, not CPU time - potentially cheaper for WASM initialization

### Cloudflare Sandbox (Native Binary)

- **Pros**: Full native performance, larger memory, no WASM overhead
- **Cons**: Container spin-up time, regional deployment
- **Best for**: Complex queries, larger datasets, batch processing

### Full ClickHouse (Container)

- **Pros**: Complete feature set, all table engines, distributed queries
- **Cons**: Infrastructure management, higher cost
- **Best for**: Production analytics, large-scale data, complex pipelines

## Build Profiles (WASM)

To manage WASM binary size and memory usage, we maintain multiple build profiles:

| Profile | Size Target | Table Engines | Formats | Use Case |
|---------|-------------|---------------|---------|----------|
| `minimal` | <5MB | Memory, S3 | JSON, Parquet | Edge queries |
| `standard` | <15MB | + MergeTree | + CSV, TSV | General analytics |
| `full` | <30MB | All supported | All supported | Full compatibility |

## Benchmarking

We use [ClickBench](https://github.com/ClickHouse/ClickBench) to benchmark across all deployment targets:

- Data replicated to R2 for Cloudflare-local testing
- Automated benchmarks for Workers, Durable Objects, Sandbox, and Container
- Cost analysis per query type

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Build WASM (requires Emscripten)
pnpm build:wasm
```

## Submodules

This repo uses git submodules for the chdb source:

```bash
# Clone with submodules
git clone --recursive https://github.com/dot-do/clickhouse

# Or initialize after clone
git submodule update --init --recursive
```

## License

Apache-2.0 - See [LICENSE](./LICENSE)
