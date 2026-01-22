#!/usr/bin/env npx tsx
/**
 * Prepare ClickBench Dataset for R2 Storage
 *
 * This script prepares the ClickBench hits dataset for use with the
 * MergeTree WASM module through R2 storage.
 *
 * Features:
 * - Validates Parquet file structure
 * - Creates a 1M row subset for testing
 * - Generates metadata for efficient querying
 * - Uploads to R2 bucket (optional)
 *
 * Usage:
 *   npx tsx scripts/prepare-clickbench.ts [options]
 *
 * Options:
 *   --input    Input Parquet file (default: data/clickbench/hits.parquet)
 *   --output   Output directory (default: data/clickbench/prepared)
 *   --subset   Create subset with N rows (default: 1000000)
 *   --upload   Upload to R2 bucket
 *   --bucket   R2 bucket name (default: clickbench-data)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  input: string;
  output: string;
  subsetRows: number;
  upload: boolean;
  bucket: string;
}

const DEFAULT_CONFIG: Config = {
  input: 'data/clickbench/hits.parquet',
  output: 'data/clickbench/prepared',
  subsetRows: 1_000_000,
  upload: false,
  bucket: 'clickbench-data',
};

// ============================================================================
// ClickBench Schema
// ============================================================================

/**
 * Complete ClickBench hits table schema
 * Based on https://github.com/ClickHouse/ClickBench
 */
export const CLICKBENCH_SCHEMA = {
  name: 'hits',
  engine: 'MergeTree',
  orderBy: ['CounterID', 'EventDate', 'UserID', 'EventTime', 'WatchID'],
  partitionBy: 'toYYYYMM(EventDate)',
  columns: [
    { name: 'WatchID', type: 'UInt64' },
    { name: 'JavaEnable', type: 'UInt8' },
    { name: 'Title', type: 'String' },
    { name: 'GoodEvent', type: 'Int16' },
    { name: 'EventTime', type: 'DateTime' },
    { name: 'EventDate', type: 'Date' },
    { name: 'CounterID', type: 'UInt32' },
    { name: 'ClientIP', type: 'UInt32' },
    { name: 'RegionID', type: 'UInt32' },
    { name: 'UserID', type: 'UInt64' },
    { name: 'CounterClass', type: 'Int8' },
    { name: 'OS', type: 'UInt8' },
    { name: 'UserAgent', type: 'UInt8' },
    { name: 'URL', type: 'String' },
    { name: 'Referer', type: 'String' },
    { name: 'IsRefresh', type: 'UInt8' },
    { name: 'RefererCategoryID', type: 'UInt16' },
    { name: 'RefererRegionID', type: 'UInt32' },
    { name: 'URLCategoryID', type: 'UInt16' },
    { name: 'URLRegionID', type: 'UInt32' },
    { name: 'ResolutionWidth', type: 'UInt16' },
    { name: 'ResolutionHeight', type: 'UInt16' },
    { name: 'ResolutionDepth', type: 'UInt8' },
    { name: 'FlashMajor', type: 'UInt8' },
    { name: 'FlashMinor', type: 'UInt8' },
    { name: 'FlashMinor2', type: 'String' },
    { name: 'NetMajor', type: 'UInt8' },
    { name: 'NetMinor', type: 'UInt8' },
    { name: 'UserAgentMajor', type: 'UInt16' },
    { name: 'UserAgentMinor', type: 'String' },
    { name: 'CookieEnable', type: 'UInt8' },
    { name: 'JavascriptEnable', type: 'UInt8' },
    { name: 'IsMobile', type: 'UInt8' },
    { name: 'MobilePhone', type: 'UInt8' },
    { name: 'MobilePhoneModel', type: 'String' },
    { name: 'Params', type: 'String' },
    { name: 'IPNetworkID', type: 'UInt32' },
    { name: 'TraficSourceID', type: 'Int8' },
    { name: 'SearchEngineID', type: 'UInt16' },
    { name: 'SearchPhrase', type: 'String' },
    { name: 'AdvEngineID', type: 'UInt8' },
    { name: 'IsArtifical', type: 'UInt8' },
    { name: 'WindowClientWidth', type: 'UInt16' },
    { name: 'WindowClientHeight', type: 'UInt16' },
    { name: 'ClientTimeZone', type: 'Int16' },
    { name: 'ClientEventTime', type: 'DateTime' },
    { name: 'SilverlightVersion1', type: 'UInt8' },
    { name: 'SilverlightVersion2', type: 'UInt8' },
    { name: 'SilverlightVersion3', type: 'UInt32' },
    { name: 'SilverlightVersion4', type: 'UInt16' },
    { name: 'PageCharset', type: 'String' },
    { name: 'CodeVersion', type: 'UInt32' },
    { name: 'IsLink', type: 'UInt8' },
    { name: 'IsDownload', type: 'UInt8' },
    { name: 'IsNotBounce', type: 'UInt8' },
    { name: 'FUniqID', type: 'UInt64' },
    { name: 'OriginalURL', type: 'String' },
    { name: 'HID', type: 'UInt32' },
    { name: 'IsOldCounter', type: 'UInt8' },
    { name: 'IsEvent', type: 'UInt8' },
    { name: 'IsParameter', type: 'UInt8' },
    { name: 'DontCountHits', type: 'UInt8' },
    { name: 'WithHash', type: 'UInt8' },
    { name: 'HitColor', type: 'String' },
    { name: 'LocalEventTime', type: 'DateTime' },
    { name: 'Age', type: 'UInt8' },
    { name: 'Sex', type: 'UInt8' },
    { name: 'Income', type: 'UInt8' },
    { name: 'Interests', type: 'UInt16' },
    { name: 'Robotness', type: 'UInt8' },
    { name: 'RemoteIP', type: 'UInt32' },
    { name: 'WindowName', type: 'Int32' },
    { name: 'OpenerName', type: 'Int32' },
    { name: 'HistoryLength', type: 'Int16' },
    { name: 'BrowserLanguage', type: 'String' },
    { name: 'BrowserCountry', type: 'String' },
    { name: 'SocialNetwork', type: 'String' },
    { name: 'SocialAction', type: 'String' },
    { name: 'HTTPError', type: 'UInt16' },
    { name: 'SendTiming', type: 'UInt32' },
    { name: 'DNSTiming', type: 'UInt32' },
    { name: 'ConnectTiming', type: 'UInt32' },
    { name: 'ResponseStartTiming', type: 'UInt32' },
    { name: 'ResponseEndTiming', type: 'UInt32' },
    { name: 'FetchTiming', type: 'UInt32' },
    { name: 'SocialSourceNetworkID', type: 'UInt8' },
    { name: 'SocialSourcePage', type: 'String' },
    { name: 'ParamPrice', type: 'Int64' },
    { name: 'ParamOrderID', type: 'String' },
    { name: 'ParamCurrency', type: 'String' },
    { name: 'ParamCurrencyID', type: 'UInt16' },
    { name: 'OpenstatServiceName', type: 'String' },
    { name: 'OpenstatCampaignID', type: 'String' },
    { name: 'OpenstatAdID', type: 'String' },
    { name: 'OpenstatSourceID', type: 'String' },
    { name: 'UTMSource', type: 'String' },
    { name: 'UTMMedium', type: 'String' },
    { name: 'UTMCampaign', type: 'String' },
    { name: 'UTMContent', type: 'String' },
    { name: 'UTMTerm', type: 'String' },
    { name: 'FromTag', type: 'String' },
    { name: 'HasGCLID', type: 'UInt8' },
    { name: 'RefererHash', type: 'UInt64' },
    { name: 'URLHash', type: 'UInt64' },
    { name: 'CLID', type: 'UInt32' },
  ],
};

// ============================================================================
// Utilities
// ============================================================================

function log(level: 'info' | 'success' | 'warn' | 'error', message: string): void {
  const colors = {
    info: '\x1b[34m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
  };
  const reset = '\x1b[0m';
  const prefix = {
    info: '[INFO]',
    success: '[SUCCESS]',
    warn: '[WARN]',
    error: '[ERROR]',
  };
  console.log(`${colors[level]}${prefix[level]}${reset} ${message}`);
}

function parseArgs(): Config {
  const config = { ...DEFAULT_CONFIG };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
        config.input = args[++i];
        break;
      case '--output':
        config.output = args[++i];
        break;
      case '--subset':
        config.subsetRows = parseInt(args[++i], 10);
        break;
      case '--upload':
        config.upload = true;
        break;
      case '--bucket':
        config.bucket = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
ClickBench Dataset Preparation Tool

Usage:
  npx tsx scripts/prepare-clickbench.ts [options]

Options:
  --input    Input Parquet file (default: ${DEFAULT_CONFIG.input})
  --output   Output directory (default: ${DEFAULT_CONFIG.output})
  --subset   Create subset with N rows (default: ${DEFAULT_CONFIG.subsetRows})
  --upload   Upload to R2 bucket
  --bucket   R2 bucket name (default: ${DEFAULT_CONFIG.bucket})
  --help     Show this help message

Examples:
  # Prepare with defaults
  npx tsx scripts/prepare-clickbench.ts

  # Create a smaller subset
  npx tsx scripts/prepare-clickbench.ts --subset 100000

  # Upload to R2
  npx tsx scripts/prepare-clickbench.ts --upload --bucket my-bucket
`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ============================================================================
// Parquet Validation
// ============================================================================

interface ParquetInfo {
  size: number;
  numRowGroups?: number;
  numRows?: number;
  schema?: string[];
}

async function validateParquetFile(filePath: string): Promise<ParquetInfo> {
  log('info', `Validating Parquet file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const info: ParquetInfo = {
    size: stats.size,
  };

  log('info', `File size: ${formatBytes(stats.size)}`);

  // Read Parquet footer to validate format
  const fd = fs.openSync(filePath, 'r');
  try {
    // Read last 8 bytes (4-byte footer length + 4-byte magic)
    const footer = Buffer.alloc(8);
    fs.readSync(fd, footer, 0, 8, stats.size - 8);

    // Check magic bytes (PAR1)
    const magic = footer.slice(4, 8).toString('ascii');
    if (magic !== 'PAR1') {
      throw new Error('Invalid Parquet file: magic bytes not found');
    }

    const footerLength = footer.readUInt32LE(0);
    log('info', `Parquet footer length: ${formatBytes(footerLength)}`);
    log('success', 'Valid Parquet file format');
  } finally {
    fs.closeSync(fd);
  }

  return info;
}

// ============================================================================
// Metadata Generation
// ============================================================================

interface DatasetMetadata {
  name: string;
  version: string;
  source: string;
  schema: typeof CLICKBENCH_SCHEMA;
  files: {
    path: string;
    size: number;
    rows?: number;
    format: string;
  }[];
  createdAt: string;
  statistics: {
    totalRows?: number;
    totalSize: number;
    columns: number;
  };
}

function generateMetadata(
  config: Config,
  parquetInfo: ParquetInfo,
  subsetInfo?: ParquetInfo
): DatasetMetadata {
  const files: DatasetMetadata['files'] = [];

  // Full dataset
  if (fs.existsSync(config.input)) {
    files.push({
      path: 'hits.parquet',
      size: parquetInfo.size,
      rows: parquetInfo.numRows,
      format: 'parquet',
    });
  }

  // Subset
  if (subsetInfo) {
    files.push({
      path: 'hits_subset.parquet',
      size: subsetInfo.size,
      rows: config.subsetRows,
      format: 'parquet',
    });
  }

  return {
    name: 'ClickBench Hits Dataset',
    version: '1.0.0',
    source: 'https://clickhouse.com/benchmark/hits',
    schema: CLICKBENCH_SCHEMA,
    files,
    createdAt: new Date().toISOString(),
    statistics: {
      totalRows: 99_997_497,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      columns: CLICKBENCH_SCHEMA.columns.length,
    },
  };
}

// ============================================================================
// Subset Creation
// ============================================================================

async function createSubset(config: Config): Promise<ParquetInfo | null> {
  log('info', `Creating subset with ${config.subsetRows.toLocaleString()} rows`);

  // Check if we have DuckDB CLI for subset creation
  let hasDuckDB = false;
  try {
    execSync('which duckdb', { stdio: 'pipe' });
    hasDuckDB = true;
  } catch {
    // DuckDB not available
  }

  if (!hasDuckDB) {
    log('warn', 'DuckDB CLI not found. Skipping subset creation.');
    log('info', 'Install DuckDB: brew install duckdb (macOS) or see https://duckdb.org');

    // Try to use existing subset from partitioned download
    const partitionedSubset = path.join(path.dirname(config.input), 'hits_subset.parquet');
    if (fs.existsSync(partitionedSubset)) {
      log('info', `Using existing subset: ${partitionedSubset}`);
      return validateParquetFile(partitionedSubset);
    }

    return null;
  }

  const outputSubset = path.join(config.output, 'hits_subset.parquet');

  // Use DuckDB to create subset
  const sql = `
    COPY (
      SELECT * FROM read_parquet('${config.input}')
      LIMIT ${config.subsetRows}
    ) TO '${outputSubset}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `;

  log('info', 'Running DuckDB to create subset...');
  try {
    execSync(`duckdb -c "${sql}"`, { stdio: 'inherit' });
    log('success', `Subset created: ${outputSubset}`);
    return validateParquetFile(outputSubset);
  } catch (error) {
    log('error', `Failed to create subset: ${error}`);
    return null;
  }
}

// ============================================================================
// R2 Upload
// ============================================================================

async function uploadToR2(config: Config): Promise<void> {
  log('info', `Uploading to R2 bucket: ${config.bucket}`);

  const files = [
    { local: config.input, remote: 'hits.parquet' },
    { local: path.join(config.output, 'hits_subset.parquet'), remote: 'hits_subset.parquet' },
    { local: path.join(config.output, 'metadata.json'), remote: 'metadata.json' },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.local)) {
      log('warn', `Skipping missing file: ${file.local}`);
      continue;
    }

    log('info', `Uploading ${file.local} to ${file.remote}...`);
    try {
      execSync(
        `wrangler r2 object put ${config.bucket}/${file.remote} --file "${file.local}"`,
        { stdio: 'inherit' }
      );
      log('success', `Uploaded: ${file.remote}`);
    } catch (error) {
      log('error', `Failed to upload ${file.remote}: ${error}`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('\n============================================');
  console.log('  ClickBench Dataset Preparation');
  console.log('============================================\n');

  const config = parseArgs();

  // Create output directory
  fs.mkdirSync(config.output, { recursive: true });
  log('info', `Output directory: ${config.output}`);

  // Check for input file
  if (!fs.existsSync(config.input)) {
    log('error', `Input file not found: ${config.input}`);
    log('info', 'Run ./scripts/download-clickbench.sh first');
    process.exit(1);
  }

  // Validate Parquet file
  const parquetInfo = await validateParquetFile(config.input);

  // Create subset
  const subsetInfo = await createSubset(config);

  // Generate metadata
  const metadata = generateMetadata(config, parquetInfo, subsetInfo ?? undefined);
  const metadataPath = path.join(config.output, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  log('success', `Metadata written to: ${metadataPath}`);

  // Write schema file
  const schemaPath = path.join(config.output, 'schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(CLICKBENCH_SCHEMA, null, 2));
  log('success', `Schema written to: ${schemaPath}`);

  // Upload to R2 if requested
  if (config.upload) {
    await uploadToR2(config);
  }

  // Summary
  console.log('\n============================================');
  console.log('  Summary');
  console.log('============================================\n');

  console.log('Files prepared:');
  for (const file of metadata.files) {
    console.log(`  - ${file.path}: ${formatBytes(file.size)}`);
  }

  console.log(`\nTotal columns: ${metadata.statistics.columns}`);
  console.log(`Expected rows: ~${(metadata.statistics.totalRows ?? 0).toLocaleString()}`);

  if (!config.upload) {
    console.log('\nTo upload to R2:');
    console.log(`  npx tsx scripts/prepare-clickbench.ts --upload --bucket ${config.bucket}`);
  }

  console.log('\nDone!\n');
}

main().catch((error) => {
  log('error', `Failed: ${error.message}`);
  process.exit(1);
});
