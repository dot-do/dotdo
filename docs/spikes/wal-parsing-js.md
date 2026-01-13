# WAL Parsing in Pure JavaScript

**Issue:** dotdo-g32ta
**Date:** 2026-01-13
**Author:** Research Spike
**Priority:** P0 (Critical)
**Labels:** cdc, derisk, spike

## Executive Summary

This spike investigates Write-Ahead Log (WAL) parsing capabilities in pure JavaScript for implementing Change Data Capture (CDC) in the Workers/edge environment. Key findings:

- **SQLite WAL**: Binary format is well-documented and feasible to parse in pure JS
- **PostgreSQL WAL**: Requires server-side logical decoding plugins (pgoutput, wal2json)
- **MySQL binlog**: Node.js libraries exist (ZongJi) but require TCP connections to MySQL
- **Edge Strategy**: For Cloudflare Workers, recommend SQLite WAL parsing + trigger-based CDC

**Recommendation:** Implement a hybrid approach using:
1. Pure JS SQLite WAL parser for local DO/D1 databases
2. Trigger-based CDC tables for real-time capture
3. JSON-based protocol for external database CDC via wal2json/pgoutput

## WAL Format Analysis

### SQLite WAL Format (Most Viable for Edge)

SQLite's WAL format is the most accessible for pure JavaScript implementation:

#### WAL Header (32 bytes)

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | magic | `0x377f0682` (little-endian) or `0x377f0683` (big-endian) |
| 4 | 4 | version | File format version (3007000) |
| 8 | 4 | pageSize | Database page size in bytes |
| 12 | 4 | checkpointSeq | Checkpoint sequence number |
| 16 | 4 | salt1 | Random value, incremented each checkpoint |
| 20 | 4 | salt2 | Different random value each checkpoint |
| 24 | 4 | checksum1 | First part of header checksum |
| 28 | 4 | checksum2 | Second part of header checksum |

#### Frame Header (24 bytes per frame)

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | pageNumber | Page number in database |
| 4 | 4 | dbSize | Database size after commit (0 for non-commit) |
| 8 | 4 | salt1 | Must match WAL header |
| 12 | 4 | salt2 | Must match WAL header |
| 16 | 4 | checksum1 | Cumulative checksum |
| 20 | 4 | checksum2 | Cumulative checksum |

#### Checksum Algorithm

SQLite uses a Fibonacci-weighted checksum on 32-bit integers:

```typescript
function sqliteChecksum(data: Uint8Array, bigEndian: boolean): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let s0 = 0, s1 = 0

  for (let i = 0; i < data.length; i += 8) {
    const x0 = view.getUint32(i, !bigEndian)
    const x1 = view.getUint32(i + 4, !bigEndian)
    s0 = (s0 + x0 + s1) >>> 0
    s1 = (s1 + x1 + s0) >>> 0
  }

  return [s0, s1]
}
```

**Feasibility:** HIGH - Binary format is simple and well-documented.

### PostgreSQL WAL Format (Server-Side Only)

PostgreSQL WAL uses a complex binary format with:
- Segmented files (16 MB default)
- Timeline-based naming
- Internal log sequence numbers (LSN)
- Complex record types (heap, btree, etc.)

**Key Insight:** Direct WAL parsing is not practical. PostgreSQL provides *logical decoding* plugins that transform WAL into consumable formats:

1. **pgoutput** - Native protocol for logical replication (binary)
2. **wal2json** - Transforms WAL to JSON format
3. **test_decoding** - Human-readable format for testing

For edge environments, the recommended approach is to consume the JSON output from these plugins rather than parsing raw WAL.

**Feasibility:** LOW for direct parsing, HIGH with logical decoding plugins.

### MySQL Binary Log Format

MySQL binlog uses a binary event format:
- Event header (19-23 bytes depending on version)
- Event-type specific payload
- Support for row-based, statement-based, and mixed logging

**Existing JS Libraries:**
- **ZongJi** - Pure JS MySQL binlog parser (requires MySQL connection)
- **mysql-binlog-emitter** - Node.js replication protocol implementation
- **mysql-events** - High-level wrapper around ZongJi

**Limitation:** All require establishing a replication connection to MySQL server, which is not suitable for serverless edge environments due to connection management.

**Feasibility:** MEDIUM - Libraries exist but require persistent connections.

## Existing CDC Implementation in dotdo

The codebase already has comprehensive CDC infrastructure:

### Core CDC Primitive (`db/primitives/cdc/`)

```typescript
// Stream with exactly-once delivery
const stream = createCDCStream<User>({
  onChange: async (event) => {
    // INSERT, UPDATE, DELETE events
  },
})

// Capture adapters
const capture = createPollingCapture<User>({
  source: dataSource,
  pollIntervalMs: 5000,
})

const logCapture = createLogCapture<User>({
  parser: walParser, // Pluggable WAL parser interface
  onChange: handler,
})
```

### WAL Manager (`objects/persistence/wal-manager.ts`)

The DO persistence layer already implements application-level WAL:

```typescript
// Transaction support with ACID guarantees
await walManager.append('INSERT', 'users', payload, txId)
await walManager.commitTransaction(txId)

// Crash recovery
const result = await walManager.recover({
  onReplay: (entry) => applyEntry(entry)
})
```

### CDC Pipeline (`primitives/gitx/src/tiered/cdc-pipeline.ts`)

A complete CDC pipeline for git operations with:
- Event batching
- Parquet transformation
- Retry with exponential backoff
- Dead letter queue

## Recommended Strategy for Edge Environments

### Tier 1: SQLite WAL Parsing (Pure JS)

Implement a pure JavaScript SQLite WAL parser for local database change capture:

```typescript
interface SQLiteWALParser {
  // Parse WAL header and validate
  parseHeader(data: Uint8Array): WALHeader

  // Iterate valid frames
  parseFrames(data: Uint8Array): Iterator<WALFrame>

  // Extract changed pages with before/after
  getChanges(frame: WALFrame): PageChange[]
}
```

**Use Cases:**
- D1 database change tracking
- Durable Object SQLite state CDC
- Local-first sync scenarios

**Implementation Complexity:** MEDIUM (2-3 days)

### Tier 2: Trigger-Based CDC

For databases where WAL access is unavailable, use SQL triggers:

```sql
-- Change tracking table
CREATE TABLE _cdc_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL, -- INSERT, UPDATE, DELETE
  row_id TEXT NOT NULL,
  old_data TEXT,
  new_data TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Per-table triggers
CREATE TRIGGER users_after_insert AFTER INSERT ON users
BEGIN
  INSERT INTO _cdc_changes (table_name, operation, row_id, new_data)
  VALUES ('users', 'INSERT', NEW.id, json_object('id', NEW.id, 'name', NEW.name));
END;
```

**Use Cases:**
- D1 without direct WAL access
- Cross-tenant change federation
- Audit logging

**Implementation Complexity:** LOW (1 day, already partially exists)

### Tier 3: External Database CDC via JSON Protocols

For PostgreSQL/MySQL CDC, consume JSON output from server-side plugins:

```typescript
interface ExternalCDCConnector {
  // PostgreSQL with wal2json
  connectPostgres(config: {
    connectionString: string
    slotName: string
    publication: string
  }): AsyncIterable<CDCChange>

  // MySQL via Debezium/Maxwell JSON
  connectMySQL(config: {
    kafkaBroker: string
    topic: string
  }): AsyncIterable<CDCChange>
}
```

**Use Cases:**
- Syncing external databases to edge
- Hybrid cloud architectures
- Legacy system integration

**Implementation Complexity:** HIGH (requires external infrastructure)

## Proposed SQLite WAL Parser Implementation

### Core Parser Module

```typescript
// db/primitives/wal-parser/sqlite-wal.ts

export interface WALHeader {
  magic: number
  bigEndian: boolean
  version: number
  pageSize: number
  checkpointSeq: number
  salt1: number
  salt2: number
  checksum: [number, number]
}

export interface WALFrame {
  pageNumber: number
  dbSizeAfterCommit: number
  salt1: number
  salt2: number
  checksum: [number, number]
  pageData: Uint8Array
  isCommit: boolean
}

export interface WALChange {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  pageNumber: number
  frameIndex: number
  timestamp: number
}

export class SQLiteWALParser {
  private header: WALHeader | null = null

  parseHeader(data: Uint8Array): WALHeader {
    if (data.length < 32) {
      throw new Error('WAL header requires at least 32 bytes')
    }

    const view = new DataView(data.buffer, data.byteOffset, 32)
    const magic = view.getUint32(0, false) // Always read as big-endian first

    const bigEndian = magic === 0x377f0683
    const littleEndian = magic === 0x377f0682

    if (!bigEndian && !littleEndian) {
      throw new Error(`Invalid WAL magic number: 0x${magic.toString(16)}`)
    }

    this.header = {
      magic,
      bigEndian,
      version: view.getUint32(4, !bigEndian),
      pageSize: view.getUint32(8, !bigEndian),
      checkpointSeq: view.getUint32(12, !bigEndian),
      salt1: view.getUint32(16, !bigEndian),
      salt2: view.getUint32(20, !bigEndian),
      checksum: [
        view.getUint32(24, !bigEndian),
        view.getUint32(28, !bigEndian),
      ],
    }

    return this.header
  }

  *parseFrames(data: Uint8Array): Generator<WALFrame> {
    if (!this.header) {
      this.parseHeader(data)
    }

    const { pageSize, salt1, salt2, bigEndian } = this.header!
    const frameSize = 24 + pageSize
    let offset = 32 // Start after header

    while (offset + frameSize <= data.length) {
      const view = new DataView(data.buffer, data.byteOffset + offset, 24)

      const frameSalt1 = view.getUint32(8, !bigEndian)
      const frameSalt2 = view.getUint32(12, !bigEndian)

      // Validate salts match
      if (frameSalt1 !== salt1 || frameSalt2 !== salt2) {
        break // End of valid frames
      }

      const dbSize = view.getUint32(4, !bigEndian)

      yield {
        pageNumber: view.getUint32(0, !bigEndian),
        dbSizeAfterCommit: dbSize,
        salt1: frameSalt1,
        salt2: frameSalt2,
        checksum: [
          view.getUint32(16, !bigEndian),
          view.getUint32(20, !bigEndian),
        ],
        pageData: data.slice(offset + 24, offset + 24 + pageSize),
        isCommit: dbSize > 0,
      }

      offset += frameSize
    }
  }
}
```

### Integration with Existing CDC Stream

```typescript
// db/primitives/cdc/wal-capture.ts

import { SQLiteWALParser, WALFrame } from '../wal-parser/sqlite-wal'
import { createCDCStream, ChangeType } from './stream'

export function createWALCapture(options: {
  walPath: string
  onChange: (change: CDCChange) => Promise<void>
}) {
  const parser = new SQLiteWALParser()

  return {
    async processWAL(walData: Uint8Array) {
      parser.parseHeader(walData)

      for (const frame of parser.parseFrames(walData)) {
        if (frame.isCommit) {
          await options.onChange({
            type: ChangeType.UPDATE, // Needs page analysis for exact type
            pageNumber: frame.pageNumber,
            timestamp: Date.now(),
            data: frame.pageData,
          })
        }
      }
    }
  }
}
```

## Comparison Matrix

| Approach | Edge Compatible | Complexity | Latency | Data Fidelity |
|----------|-----------------|------------|---------|---------------|
| SQLite WAL Parsing | YES | Medium | Low | High |
| Trigger-based CDC | YES | Low | Low | High |
| wal2json (PG) | Via proxy | High | Medium | High |
| ZongJi (MySQL) | NO (TCP) | High | Low | High |
| Polling-based | YES | Low | High | Medium |

## Risk Assessment

### Technical Risks

1. **SQLite Page Format Changes**: SQLite page format is stable but changes between major versions. Mitigation: Version detection and format validation.

2. **Checkpoint Interference**: WAL files are truncated during checkpoints. Mitigation: Use checkpoint hooks or copy WAL before processing.

3. **Memory Constraints**: Large WAL files could exceed Worker memory limits. Mitigation: Streaming parser with frame-by-frame processing.

### Operational Risks

1. **D1 WAL Access**: Cloudflare D1 may not expose raw WAL files. Mitigation: Trigger-based fallback.

2. **DO SQLite Integration**: Durable Object SQLite access patterns may differ. Mitigation: Test with miniflare first.

## Recommendations

### Immediate Actions (P0)

1. **Implement SQLite WAL Parser**: Create `db/primitives/wal-parser/sqlite-wal.ts` with header and frame parsing.

2. **Add Trigger-based CDC**: Extend `db/primitives/cdc/` with trigger generation utilities for D1/DO SQLite.

3. **Benchmark Memory Usage**: Test WAL parsing with varying file sizes in Workers environment.

### Future Considerations (P1-P2)

1. **Page-level Diff**: Extract row-level changes from page data (requires B-tree parsing).

2. **External DB Connectors**: Build adapters for wal2json and MySQL JSON outputs.

3. **Streaming WAL Tail**: Implement continuous WAL monitoring for real-time CDC.

## References

- [SQLite WAL Format](https://sqlite.org/fileformat.html) - Official binary specification
- [PostgreSQL Logical Decoding](https://wiki.postgresql.org/wiki/Logical_Decoding_Plugins) - Plugin ecosystem
- [ZongJi MySQL Binlog](https://github.com/nevill/zongji) - Node.js binlog parser
- [wal2json Plugin](https://olake.io/docs/connectors/postgres/wal2json_plugin/) - JSON output format
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/) - Serverless SQLite
- [Durable Objects SQLite](https://developers.cloudflare.com/durable-objects/) - Edge storage

## Conclusion

WAL parsing in pure JavaScript is feasible for SQLite and provides a foundation for edge-native CDC. The recommended approach combines:

1. **Pure JS SQLite WAL parser** for local database changes
2. **Trigger-based CDC** as a reliable fallback
3. **JSON protocol adapters** for external databases

This hybrid strategy balances implementation complexity with edge environment constraints while maintaining high data fidelity and low latency.
