# primitive-file-ops

**A filesystem. In a database. On the edge.**

Process files without servers, containers, or VMs. fsx gives you a POSIX-compatible filesystem backed by SQLite and R2, running in V8 isolates across 300+ cities.

```typescript
import { DO } from 'dotdo'

export class DataProcessor extends DO {
  async processDataImport(csvUrl: string) {
    // Download and save to your DO's filesystem
    const response = await fetch(csvUrl)
    await this.$.fs.write('/imports/data.csv', await response.text())

    // Read it back, parse it, process each record
    const csv = await this.$.fs.read('/imports/data.csv', { encoding: 'utf-8' })
    const records = parseCSV(csv)

    // Write results to individual files (10,000 files? No problem.)
    await Promise.all(
      records.map((record, i) =>
        this.$.fs.write(`/results/${i}.json`, JSON.stringify(record))
      )
    )

    // List all results
    const files = await this.$.fs.list('/results')
    return { processed: files.length }
  }
}
```

You just processed 10,000 files. No disk. No container. No cold starts.

## How It Works

Every Durable Object gets its own filesystem:

```
/                          # Root of your DO's filesystem
├── imports/               # Your data directory
│   └── data.csv           # 50MB CSV? Stored in R2 automatically
├── results/               # Output directory
│   ├── 0.json             # Small files live in SQLite (hot tier)
│   ├── 1.json             # Microsecond access times
│   └── ...
└── reports/
    └── summary.md         # Generated reports
```

**Two storage tiers, zero configuration:**
- **Hot tier (SQLite)**: Files under 1MB. Stored in DO's SQLite database. Microsecond latency.
- **Warm tier (R2)**: Larger files. Automatic tier routing. Cost-effective at scale.

## The Full API

```typescript
// Write files
await $.fs.write('/config.json', JSON.stringify(config))
await $.fs.write('/binary.dat', new Uint8Array([1, 2, 3]))

// Read files
const text = await $.fs.read('/config.json', { encoding: 'utf-8' })
const bytes = await $.fs.read('/binary.dat')

// List directories
const files = await $.fs.list('/data')                    // ['a.txt', 'b.txt']
const entries = await $.fs.list('/data', { withTypes: true }) // Dirent[]

// Directory operations
await $.fs.mkdir('/data/processed', { recursive: true })
await $.fs.rmdir('/data/temp')
await $.fs.rm('/old-file.txt')

// File metadata
const stats = await $.fs.stat('/config.json')
console.log(stats.size, stats.mtime, stats.isFile())

// Check existence
if (await $.fs.exists('/config.json')) { ... }

// Streaming for large files
const stream = await $.fs.createReadStream('/large.csv')
const writer = await $.fs.createWriteStream('/output.bin')

// Symbolic links
await $.fs.symlink('/config.json', '/link-to-config')
const target = await $.fs.readlink('/link-to-config')

// Tiered storage control
const tier = await $.fs.getTier('/large-file.bin')  // 'hot' | 'warm' | 'cold'
await $.fs.promote('/archive/old.log', 'hot')       // Move to faster storage
await $.fs.demote('/data/old.csv', 'warm')          // Move to cheaper storage

// Atomic batch writes
await $.fs.writeMany([
  { path: '/a.txt', content: 'A' },
  { path: '/b.txt', content: 'B' },
])
```

## Running This Example

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Test the endpoints
curl http://localhost:8787/process -d '{"url":"https://example.com/data.csv"}'
curl http://localhost:8787/files
curl http://localhost:8787/stats
```

## What You Get

- **POSIX-compatible**: `read`, `write`, `mkdir`, `stat`, `chmod`, `symlink`...
- **Automatic tiering**: Small files hot, large files warm. Zero config.
- **Atomic operations**: Transactions, batch writes, crash recovery.
- **No cold starts**: V8 isolates spin up in 0ms. Your files are already there.
- **Global edge**: 300+ cities. Files follow your DO instance.

## See Also

- [fsx.do](https://fsx.do) - The filesystem primitive
- [gitx.do](https://gitx.do) - Git-on-R2 primitive
- [bashx.do](https://bashx.do) - Shell-without-VMs primitive
