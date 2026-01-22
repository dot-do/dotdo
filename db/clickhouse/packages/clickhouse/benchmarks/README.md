# ClickBench Data Setup for R2

This directory contains scripts and configuration for setting up [ClickBench](https://github.com/ClickHouse/ClickBench) benchmark data in Cloudflare R2.

## Overview

ClickBench is a benchmark for analytical databases using real-world web analytics data. The dataset contains **99,997,497 records** of anonymized clickstream data from production web traffic.

## Dataset Information

| Format | Size | Source |
|--------|------|--------|
| Parquet | ~15GB | `https://datasets.clickhouse.com/hits_compatible/hits.parquet` |
| Partitioned Parquet | ~15GB | `https://datasets.clickhouse.com/hits_compatible/athena_partitioned/hits_{0..99}.parquet` |
| CSV (gzipped) | ~8GB | `https://datasets.clickhouse.com/hits_compatible/hits.csv.gz` |
| TSV (gzipped) | ~8GB | `https://datasets.clickhouse.com/hits_compatible/hits.tsv.gz` |

## Prerequisites

1. **Cloudflare R2 bucket** - Create a bucket named `clickbench-data` (or update config)
2. **rclone** or **AWS CLI** - For uploading data to R2
3. **curl** or **wget** - For downloading the dataset

### Installing rclone

```bash
# macOS
brew install rclone

# Linux
curl https://rclone.org/install.sh | sudo bash
```

### Configuring rclone for R2

```bash
rclone config

# Choose: n (new remote)
# Name: r2
# Storage: s3
# Provider: Cloudflare
# Access Key ID: <your R2 access key>
# Secret Access Key: <your R2 secret key>
# Endpoint: https://<account_id>.r2.cloudflarestorage.com
```

Alternatively, set environment variables:
```bash
export R2_ACCESS_KEY_ID="your_access_key"
export R2_SECRET_ACCESS_KEY="your_secret_key"
export R2_ACCOUNT_ID="your_account_id"
```

## Quick Start

```bash
# Make the setup script executable
chmod +x setup-r2.sh

# Run the setup (downloads ~15GB and uploads to R2)
./setup-r2.sh
```

## Manual Setup

### 1. Download the Dataset

```bash
# Single Parquet file (~15GB)
curl -O https://datasets.clickhouse.com/hits_compatible/hits.parquet

# Or partitioned files (100 files, better for parallel processing)
mkdir -p hits_partitioned
for i in $(seq 0 99); do
  curl -o "hits_partitioned/hits_$i.parquet" \
    "https://datasets.clickhouse.com/hits_compatible/athena_partitioned/hits_$i.parquet"
done
```

### 2. Upload to R2

```bash
# Using rclone
rclone copy hits.parquet r2:clickbench-data/ \
  --header-upload "Cache-Control: public, max-age=31536000"

# Or using AWS CLI
aws s3 cp hits.parquet s3://clickbench-data/ \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
  --cache-control "public, max-age=31536000"
```

## Expected R2 Bucket Structure

```
clickbench-data/
├── hits.parquet              # Single file (~15GB)
└── partitioned/              # Optional: partitioned data
    ├── hits_0.parquet
    ├── hits_1.parquet
    ├── ...
    └── hits_99.parquet
```

## Size Requirements

| Component | Size |
|-----------|------|
| Local download | ~15GB |
| R2 storage | ~15GB |
| Total disk space needed | ~30GB (during upload) |

## Benchmark Queries

The `queries/` directory contains all 43 ClickBench queries adapted for chdb/ClickHouse:

- `queries.sql` - All queries in a single file
- `schema.sql` - Table schema definition

## Running Benchmarks

```typescript
import { benchmarkConfig } from './config';

// Access R2 data URL
const dataUrl = `https://${benchmarkConfig.r2Bucket}.r2.dev/${benchmarkConfig.dataPath}`;

// Run queries
for (const query of benchmarkConfig.queries) {
  const result = await db.query(query);
  console.log(result);
}
```

## Verification

After upload, verify the data:

```bash
# Check file exists in R2
rclone ls r2:clickbench-data/

# Verify file size (~15GB)
rclone size r2:clickbench-data/hits.parquet
```

## References

- [ClickBench Repository](https://github.com/ClickHouse/ClickBench)
- [ClickBench Results](https://benchmark.clickhouse.com/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [chdb Documentation](https://doc.chdb.io/)
