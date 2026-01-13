[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorEngineType

# Type Alias: VectorEngineType

> **VectorEngineType** = `"libsql"` \| `"edgevec"` \| `"vectorize"` \| `"clickhouse"` \| `"iceberg"`

Defined in: [db/core/types.ts:467](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L467)

Vector search engine
- libsql: libSQL native F32_BLOB vectors
- edgevec: EdgeVec WASM HNSW via Workers RPC
- vectorize: Cloudflare Vectorize
- clickhouse: ClickHouse ANN indexes
- iceberg: Iceberg Parquet with vector columns
