#!/usr/bin/env npx tsx
/**
 * Create Test MergeTree Data in R2
 *
 * This script creates test MergeTree data that can be queried via the chdb-lake worker.
 * It demonstrates the MergeTree VFS format and provides data for integration testing.
 *
 * Usage:
 *   # Run via wrangler against local dev worker
 *   npx tsx configs/chdb-lake/scripts/create-test-mergetree.ts --local
 *
 *   # Run against deployed worker
 *   npx tsx configs/chdb-lake/scripts/create-test-mergetree.ts --remote
 *
 * Schema:
 *   Table: default.test_hits
 *   Columns: id (UInt64), url (String), views (UInt32), date (Date)
 *   Primary key: id
 *   Order by: id
 */

// =============================================================================
// Configuration
// =============================================================================

const TABLE_CONFIG = {
  database: 'default',
  table: 'test_hits',
  columns: [
    { name: 'id', type: 'UInt64' },
    { name: 'url', type: 'String' },
    { name: 'views', type: 'UInt32' },
    { name: 'date', type: 'Date' },
  ],
  primaryKey: ['id'],
  orderBy: ['id'],
  partition: 'all', // Single partition for testing
  partName: 'all_1_1_0',
};

// Test data
const TEST_DATA = [
  { id: 1n, url: 'https://example.com/', views: 100, date: '2024-01-15' },
  { id: 2n, url: 'https://example.com/about', views: 50, date: '2024-01-15' },
  { id: 3n, url: 'https://example.com/products', views: 200, date: '2024-01-16' },
  { id: 4n, url: 'https://example.com/contact', views: 25, date: '2024-01-16' },
  { id: 5n, url: 'https://example.com/blog', views: 150, date: '2024-01-17' },
  { id: 6n, url: 'https://example.com/blog/post1', views: 75, date: '2024-01-17' },
  { id: 7n, url: 'https://example.com/blog/post2', views: 120, date: '2024-01-18' },
  { id: 8n, url: 'https://example.com/pricing', views: 300, date: '2024-01-18' },
  { id: 9n, url: 'https://example.com/docs', views: 180, date: '2024-01-19' },
  { id: 10n, url: 'https://example.com/api', views: 90, date: '2024-01-19' },
];

// =============================================================================
// MergeTree Binary Format Writers
// =============================================================================

/**
 * Write a UInt64 in little-endian format
 */
function writeUInt64LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, value, true);
  return new Uint8Array(buf);
}

/**
 * Write a UInt32 in little-endian format
 */
function writeUInt32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint32(0, value, true);
  return new Uint8Array(buf);
}

/**
 * Write a UInt16 in little-endian format (for Date type - days since 1970-01-01)
 */
function writeUInt16LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint16(0, value, true);
  return new Uint8Array(buf);
}

/**
 * Write a variable-length string with length prefix (LEB128-style)
 */
function writeVarString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const length = encoded.length;

  // Write length as varint (LEB128)
  const lengthBytes: number[] = [];
  let remaining = length;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining > 0) {
      byte |= 0x80;
    }
    lengthBytes.push(byte);
  } while (remaining > 0);

  const result = new Uint8Array(lengthBytes.length + encoded.length);
  result.set(lengthBytes, 0);
  result.set(encoded, lengthBytes.length);
  return result;
}

/**
 * Convert date string (YYYY-MM-DD) to days since epoch
 */
function dateToDays(dateStr: string): number {
  const date = new Date(dateStr);
  const epoch = new Date('1970-01-01');
  return Math.floor((date.getTime() - epoch.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Create a .bin file for UInt64 column (uncompressed)
 */
function createUInt64Bin(values: bigint[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const value of values) {
    chunks.push(writeUInt64LE(value));
  }
  return concatUint8Arrays(chunks);
}

/**
 * Create a .bin file for UInt32 column (uncompressed)
 */
function createUInt32Bin(values: number[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const value of values) {
    chunks.push(writeUInt32LE(value));
  }
  return concatUint8Arrays(chunks);
}

/**
 * Create a .bin file for Date column (uncompressed)
 * Date is stored as UInt16 (days since epoch)
 */
function createDateBin(values: string[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const value of values) {
    chunks.push(writeUInt16LE(dateToDays(value)));
  }
  return concatUint8Arrays(chunks);
}

/**
 * Create a .bin file for String column (uncompressed)
 */
function createStringBin(values: string[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const value of values) {
    chunks.push(writeVarString(value));
  }
  return concatUint8Arrays(chunks);
}

/**
 * Create a .mrk3 mark file for a column
 * Mark files contain (offset_in_compressed, offset_in_decompressed, rows_count) tuples
 * For uncompressed data, both offsets are the same
 */
function createMark3File(
  rowCount: number,
  rowSize: number,
  granularity: number = 8192
): Uint8Array {
  // For small test data, we have just one mark entry
  // Format: offset_compressed (uint64), offset_uncompressed (uint64), row_count (uint64)
  const chunks: Uint8Array[] = [];

  // Single mark at beginning of data
  chunks.push(writeUInt64LE(0n)); // offset in compressed data
  chunks.push(writeUInt64LE(0n)); // offset in uncompressed data
  chunks.push(writeUInt64LE(BigInt(rowCount))); // number of rows

  return concatUint8Arrays(chunks);
}

/**
 * Create a simplified mark file for variable-length String column
 */
function createStringMark3File(
  values: string[],
  granularity: number = 8192
): Uint8Array {
  const chunks: Uint8Array[] = [];

  // Calculate total offset for the mark
  let offset = 0;
  for (const value of values) {
    const strBytes = new TextEncoder().encode(value);
    // Length prefix + string bytes
    let lengthPrefixSize = 1;
    let length = strBytes.length;
    while (length >= 0x80) {
      lengthPrefixSize++;
      length >>>= 7;
    }
    offset += lengthPrefixSize + strBytes.length;
  }

  // Single mark at beginning
  chunks.push(writeUInt64LE(0n));
  chunks.push(writeUInt64LE(0n));
  chunks.push(writeUInt64LE(BigInt(values.length)));

  return concatUint8Arrays(chunks);
}

/**
 * Create columns.txt file listing column names and types
 */
function createColumnsTxt(): string {
  const lines: string[] = ['columns format version: 1', `${TABLE_CONFIG.columns.length} columns:`];

  for (const col of TABLE_CONFIG.columns) {
    lines.push(`\`${col.name}\` ${col.type}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Create count.txt file with row count
 */
function createCountTxt(rowCount: number): string {
  return `${rowCount}\n`;
}

/**
 * Calculate CRC32 checksum (simplified implementation)
 * Used for checksums.txt validation
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = getCrc32Table();

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

let crc32Table: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;

  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc32Table[i] = c;
  }
  return crc32Table;
}

/**
 * Create checksums.txt file
 * Format: checksum_algorithm file_name size checksum
 */
function createChecksumsTxt(files: Map<string, Uint8Array>): string {
  const lines: string[] = ['checksums format version: 4', `${files.size}`];

  for (const [name, data] of files) {
    const checksum = crc32(data);
    // Format: binary_flag name size hash128_hex uncompressed_size hash128_uncompressed_hex
    // For uncompressed files, both hashes are the same
    const hashHex = checksum.toString(16).padStart(8, '0');
    const fullHash = hashHex.repeat(4); // 32 chars (128-bit as hex)
    lines.push(`\t${name} size: ${data.length} hash: ${fullHash} uncompressed: ${data.length} hash: ${fullHash}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Create primary.idx file
 * For primary key (id), contains sorted key values at granule boundaries
 */
function createPrimaryIdx(ids: bigint[]): Uint8Array {
  // Just store the first key value for our small test data
  // In production, this would have one entry per granule
  return writeUInt64LE(ids[0]);
}

/**
 * Concatenate multiple Uint8Array into one
 */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// =============================================================================
// HTTP Client for Worker API
// =============================================================================

interface WorkerResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  json?: unknown;
}

async function fetchWorker(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: string | Uint8Array;
    headers?: Record<string, string>;
  } = {}
): Promise<WorkerResponse> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    ...options.headers,
  };

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  // Convert Uint8Array to Buffer for Node.js fetch compatibility
  let body: string | Buffer | undefined;
  if (options.body instanceof Uint8Array) {
    body = Buffer.from(options.body);
  } else {
    body = options.body;
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: body,
  });

  const responseBody = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(responseBody);
  } catch {
    // Not JSON
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: responseBody,
    json,
  };
}

// =============================================================================
// Main Script
// =============================================================================

async function createTestMergeTree(baseUrl: string): Promise<void> {
  console.log('='.repeat(60));
  console.log('Creating Test MergeTree Data');
  console.log('='.repeat(60));
  console.log(`Target: ${baseUrl}`);
  console.log(`Table: ${TABLE_CONFIG.database}.${TABLE_CONFIG.table}`);
  console.log(`Rows: ${TEST_DATA.length}`);
  console.log();

  // -------------------------------------------------------------------------
  // Step 1: Create table schema in MergeTreeDO
  // -------------------------------------------------------------------------
  console.log('Step 1: Creating table schema in MergeTreeDO...');

  const schema = {
    name: TABLE_CONFIG.table,
    database: TABLE_CONFIG.database,
    columns: TABLE_CONFIG.columns,
    primaryKey: TABLE_CONFIG.primaryKey,
    orderBy: TABLE_CONFIG.orderBy,
    settings: {},
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  // The worker exposes MergeTreeDO via fetch() HTTP interface
  // We use /mergetree/schema endpoint
  const schemaResponse = await fetchWorker(baseUrl, '/mergetree/schema', {
    method: 'PUT',
    body: JSON.stringify({
      table: TABLE_CONFIG.table,
      schema,
    }),
  });

  if (!schemaResponse.ok) {
    console.error(`Failed to create schema: ${schemaResponse.status} ${schemaResponse.body}`);
    // Continue anyway - might already exist
  } else {
    console.log('  Schema created successfully');
  }

  // -------------------------------------------------------------------------
  // Step 2: Create part data files
  // -------------------------------------------------------------------------
  console.log('\nStep 2: Creating MergeTree part files...');

  // Extract column values from test data
  const ids = TEST_DATA.map((row) => row.id);
  const urls = TEST_DATA.map((row) => row.url);
  const views = TEST_DATA.map((row) => row.views);
  const dates = TEST_DATA.map((row) => row.date);

  // Create binary column files
  const idBin = createUInt64Bin(ids);
  const urlBin = createStringBin(urls);
  const viewsBin = createUInt32Bin(views);
  const dateBin = createDateBin(dates);

  console.log(`  id.bin: ${idBin.length} bytes`);
  console.log(`  url.bin: ${urlBin.length} bytes`);
  console.log(`  views.bin: ${viewsBin.length} bytes`);
  console.log(`  date.bin: ${dateBin.length} bytes`);

  // Create mark files
  const idMrk3 = createMark3File(TEST_DATA.length, 8);
  const urlMrk3 = createStringMark3File(urls);
  const viewsMrk3 = createMark3File(TEST_DATA.length, 4);
  const dateMrk3 = createMark3File(TEST_DATA.length, 2);

  console.log(`  id.mrk3: ${idMrk3.length} bytes`);
  console.log(`  url.mrk3: ${urlMrk3.length} bytes`);
  console.log(`  views.mrk3: ${viewsMrk3.length} bytes`);
  console.log(`  date.mrk3: ${dateMrk3.length} bytes`);

  // Create metadata files
  const columnsTxt = new TextEncoder().encode(createColumnsTxt());
  const countTxt = new TextEncoder().encode(createCountTxt(TEST_DATA.length));
  const primaryIdx = createPrimaryIdx(ids);

  console.log(`  columns.txt: ${columnsTxt.length} bytes`);
  console.log(`  count.txt: ${countTxt.length} bytes`);
  console.log(`  primary.idx: ${primaryIdx.length} bytes`);

  // Build file map for checksums
  const partFiles = new Map<string, Uint8Array>([
    ['id.bin', idBin],
    ['id.mrk3', idMrk3],
    ['url.bin', urlBin],
    ['url.mrk3', urlMrk3],
    ['views.bin', viewsBin],
    ['views.mrk3', viewsMrk3],
    ['date.bin', dateBin],
    ['date.mrk3', dateMrk3],
    ['columns.txt', columnsTxt],
    ['count.txt', countTxt],
    ['primary.idx', primaryIdx],
  ]);

  // Create checksums file
  const checksumsTxt = new TextEncoder().encode(createChecksumsTxt(partFiles));
  partFiles.set('checksums.txt', checksumsTxt);
  console.log(`  checksums.txt: ${checksumsTxt.length} bytes`);

  // -------------------------------------------------------------------------
  // Step 3: Upload files to R2
  // -------------------------------------------------------------------------
  console.log('\nStep 3: Uploading part files to R2...');

  const partPrefix = `${TABLE_CONFIG.database}/${TABLE_CONFIG.table}/data/${TABLE_CONFIG.partition}/${TABLE_CONFIG.partName}`;
  const r2Keys: string[] = [];

  for (const [fileName, data] of partFiles) {
    const key = `${partPrefix}/${fileName}`;
    r2Keys.push(key);

    const uploadResponse = await fetchWorker(baseUrl, `/r2/upload?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: data,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    });

    if (!uploadResponse.ok) {
      console.error(`  Failed to upload ${fileName}: ${uploadResponse.status} ${uploadResponse.body}`);
    } else {
      console.log(`  Uploaded: ${key}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Also upload test data as JSON for the current query implementation
  // -------------------------------------------------------------------------
  console.log('\nStep 4: Uploading JSON data file (for current query impl)...');

  // Convert bigint to number for JSON serialization
  const jsonData = TEST_DATA.map((row) => ({
    ...row,
    id: Number(row.id),
  }));

  const jsonDataFile = new TextEncoder().encode(JSON.stringify(jsonData));
  const jsonKey = `${partPrefix}/data.json`;
  r2Keys.push(jsonKey);

  const jsonUploadResponse = await fetchWorker(
    baseUrl,
    `/r2/upload?key=${encodeURIComponent(jsonKey)}`,
    {
      method: 'PUT',
      body: jsonDataFile,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!jsonUploadResponse.ok) {
    console.error(`  Failed to upload data.json: ${jsonUploadResponse.status}`);
  } else {
    console.log(`  Uploaded: ${jsonKey} (${jsonDataFile.length} bytes)`);
  }

  // -------------------------------------------------------------------------
  // Step 5: Register part in MergeTreeDO
  // -------------------------------------------------------------------------
  console.log('\nStep 5: Registering part in MergeTreeDO...');

  // Calculate total bytes
  let totalBytes = 0;
  for (const data of partFiles.values()) {
    totalBytes += data.length;
  }

  const partInfo = {
    name: TABLE_CONFIG.partName,
    partition: TABLE_CONFIG.partition,
    level: 0,
    rows: TEST_DATA.length,
    bytesCompressed: totalBytes,
    bytesUncompressed: totalBytes,
    modificationTime: Date.now(),
    r2Keys: r2Keys,
    checksum: crc32(checksumsTxt).toString(16),
  };

  const registerResponse = await fetchWorker(baseUrl, '/mergetree/parts/register', {
    method: 'POST',
    body: JSON.stringify({
      table: TABLE_CONFIG.table,
      part: partInfo,
    }),
  });

  if (!registerResponse.ok) {
    console.error(`Failed to register part: ${registerResponse.status} ${registerResponse.body}`);
  } else {
    console.log('  Part registered (temporary state)');
    const registeredPart = registerResponse.json as { name: string; minBlock: number; maxBlock: number };
    console.log(`  Assigned blocks: ${registeredPart?.minBlock}-${registeredPart?.maxBlock}`);
  }

  // -------------------------------------------------------------------------
  // Step 6: Commit part (make visible for queries)
  // -------------------------------------------------------------------------
  console.log('\nStep 6: Committing part...');

  const commitResponse = await fetchWorker(baseUrl, '/mergetree/parts/commit', {
    method: 'POST',
    body: JSON.stringify({
      table: TABLE_CONFIG.table,
      partId: TABLE_CONFIG.partName,
    }),
  });

  if (!commitResponse.ok) {
    console.error(`Failed to commit part: ${commitResponse.status} ${commitResponse.body}`);
  } else {
    console.log('  Part committed successfully');
  }

  // -------------------------------------------------------------------------
  // Step 7: Verify the data
  // -------------------------------------------------------------------------
  console.log('\nStep 7: Verifying data...');

  // Test query
  const testQuery = `SELECT * FROM mergetree('${TABLE_CONFIG.database}.${TABLE_CONFIG.table}') LIMIT 5`;
  console.log(`  Query: ${testQuery}`);

  const queryResponse = await fetchWorker(baseUrl, '/', {
    method: 'POST',
    body: testQuery,
    headers: {
      'Content-Type': 'text/plain',
    },
  });

  if (!queryResponse.ok) {
    console.error(`  Query failed: ${queryResponse.status} ${queryResponse.body}`);
  } else {
    console.log('  Query result:');
    console.log(queryResponse.body.split('\n').map((line) => `    ${line}`).join('\n'));
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Table: ${TABLE_CONFIG.database}.${TABLE_CONFIG.table}`);
  console.log(`Part: ${TABLE_CONFIG.partName}`);
  console.log(`Rows: ${TEST_DATA.length}`);
  console.log(`Total bytes: ${totalBytes}`);
  console.log(`Files created: ${partFiles.size + 1}`); // +1 for data.json
  console.log();
  console.log('Example queries:');
  console.log(`  SELECT * FROM mergetree('${TABLE_CONFIG.database}.${TABLE_CONFIG.table}')`);
  console.log(`  SELECT url, views FROM mergetree('${TABLE_CONFIG.database}.${TABLE_CONFIG.table}') WHERE views > 100`);
  console.log(`  SELECT count(*) FROM mergetree('${TABLE_CONFIG.database}.${TABLE_CONFIG.table}')`);
  console.log(`  DESCRIBE ${TABLE_CONFIG.database}.${TABLE_CONFIG.table}`);
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let baseUrl: string;

  if (args.includes('--local') || args.includes('-l')) {
    baseUrl = 'http://localhost:8789';
  } else if (args.includes('--remote') || args.includes('-r')) {
    baseUrl = 'https://chdb-lake.clickhouse.workers.dev';
  } else if (args.length > 0 && !args[0].startsWith('-')) {
    baseUrl = args[0];
  } else {
    console.log('Usage: npx tsx create-test-mergetree.ts [--local | --remote | <url>]');
    console.log();
    console.log('Options:');
    console.log('  --local, -l    Use local dev server (http://localhost:8789)');
    console.log('  --remote, -r   Use deployed worker (https://chdb-lake.clickhouse.workers.dev)');
    console.log('  <url>          Use custom URL');
    console.log();
    console.log('Examples:');
    console.log('  npx tsx create-test-mergetree.ts --local');
    console.log('  npx tsx create-test-mergetree.ts https://my-worker.workers.dev');
    process.exit(1);
  }

  try {
    await createTestMergeTree(baseUrl);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
