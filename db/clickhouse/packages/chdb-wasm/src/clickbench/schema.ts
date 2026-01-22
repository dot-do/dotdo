/**
 * ClickBench Hits Table Schema
 *
 * This module defines the complete schema for the ClickBench hits table,
 * which contains 105 columns of web analytics data from Yandex Metrica.
 *
 * The hits dataset contains approximately 100 million rows of real-world
 * web traffic analysis data.
 *
 * @see https://github.com/ClickHouse/ClickBench
 */

// ============================================================================
// Column Type Definitions
// ============================================================================

/**
 * ClickHouse data type
 */
export type ClickHouseType =
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Float32'
  | 'Float64'
  | 'String'
  | 'FixedString'
  | 'Date'
  | 'DateTime'
  | 'Array';

/**
 * Column definition
 */
export interface ColumnDefinition {
  name: string;
  type: ClickHouseType;
  /** Additional type info (e.g., array element type, fixed string length) */
  typeArgs?: string;
  /** Column index (0-based) */
  index: number;
  /** Human-readable description */
  description?: string;
}

// ============================================================================
// Hits Table Schema
// ============================================================================

/**
 * Complete schema for the ClickBench hits table
 * 105 columns representing web analytics data
 */
export const HITS_COLUMNS: ColumnDefinition[] = [
  { name: 'WatchID', type: 'UInt64', index: 0, description: 'Unique page view identifier' },
  { name: 'JavaEnable', type: 'UInt8', index: 1, description: 'Java enabled in browser' },
  { name: 'Title', type: 'String', index: 2, description: 'Page title' },
  { name: 'GoodEvent', type: 'Int16', index: 3, description: 'Good event flag' },
  { name: 'EventTime', type: 'DateTime', index: 4, description: 'Event timestamp' },
  { name: 'EventDate', type: 'Date', index: 5, description: 'Event date' },
  { name: 'CounterID', type: 'UInt32', index: 6, description: 'Counter identifier' },
  { name: 'ClientIP', type: 'UInt32', index: 7, description: 'Client IP address (as integer)' },
  { name: 'RegionID', type: 'UInt32', index: 8, description: 'Region identifier' },
  { name: 'UserID', type: 'UInt64', index: 9, description: 'User identifier' },
  { name: 'CounterClass', type: 'Int8', index: 10, description: 'Counter class' },
  { name: 'OS', type: 'UInt8', index: 11, description: 'Operating system' },
  { name: 'UserAgent', type: 'UInt8', index: 12, description: 'User agent type' },
  { name: 'URL', type: 'String', index: 13, description: 'Page URL' },
  { name: 'Referer', type: 'String', index: 14, description: 'Referrer URL' },
  { name: 'IsRefresh', type: 'UInt8', index: 15, description: 'Page refresh flag' },
  { name: 'RefererCategoryID', type: 'UInt16', index: 16, description: 'Referrer category' },
  { name: 'RefererRegionID', type: 'UInt32', index: 17, description: 'Referrer region' },
  { name: 'URLCategoryID', type: 'UInt16', index: 18, description: 'URL category' },
  { name: 'URLRegionID', type: 'UInt32', index: 19, description: 'URL region' },
  { name: 'ResolutionWidth', type: 'UInt16', index: 20, description: 'Screen resolution width' },
  { name: 'ResolutionHeight', type: 'UInt16', index: 21, description: 'Screen resolution height' },
  { name: 'ResolutionDepth', type: 'UInt8', index: 22, description: 'Screen color depth' },
  { name: 'FlashMajor', type: 'UInt8', index: 23, description: 'Flash major version' },
  { name: 'FlashMinor', type: 'UInt8', index: 24, description: 'Flash minor version' },
  { name: 'FlashMinor2', type: 'String', index: 25, description: 'Flash minor version 2' },
  { name: 'NetMajor', type: 'UInt8', index: 26, description: 'Net major version' },
  { name: 'NetMinor', type: 'UInt8', index: 27, description: 'Net minor version' },
  { name: 'UserAgentMajor', type: 'UInt16', index: 28, description: 'User agent major version' },
  { name: 'UserAgentMinor', type: 'String', index: 29, description: 'User agent minor version' },
  { name: 'CookieEnable', type: 'UInt8', index: 30, description: 'Cookies enabled' },
  { name: 'JavascriptEnable', type: 'UInt8', index: 31, description: 'JavaScript enabled' },
  { name: 'IsMobile', type: 'UInt8', index: 32, description: 'Mobile device flag' },
  { name: 'MobilePhone', type: 'UInt8', index: 33, description: 'Mobile phone type' },
  { name: 'MobilePhoneModel', type: 'String', index: 34, description: 'Mobile phone model' },
  { name: 'Params', type: 'String', index: 35, description: 'Additional parameters' },
  { name: 'IPNetworkID', type: 'UInt32', index: 36, description: 'IP network identifier' },
  { name: 'TraficSourceID', type: 'Int8', index: 37, description: 'Traffic source identifier' },
  { name: 'SearchEngineID', type: 'UInt16', index: 38, description: 'Search engine identifier' },
  { name: 'SearchPhrase', type: 'String', index: 39, description: 'Search phrase' },
  { name: 'AdvEngineID', type: 'UInt8', index: 40, description: 'Advertising engine identifier' },
  { name: 'IsArtifical', type: 'UInt8', index: 41, description: 'Artificial flag' },
  { name: 'WindowClientWidth', type: 'UInt16', index: 42, description: 'Browser window width' },
  { name: 'WindowClientHeight', type: 'UInt16', index: 43, description: 'Browser window height' },
  { name: 'ClientTimeZone', type: 'Int16', index: 44, description: 'Client timezone offset' },
  { name: 'ClientEventTime', type: 'DateTime', index: 45, description: 'Client event timestamp' },
  { name: 'SilverlightVersion1', type: 'UInt8', index: 46, description: 'Silverlight version 1' },
  { name: 'SilverlightVersion2', type: 'UInt8', index: 47, description: 'Silverlight version 2' },
  { name: 'SilverlightVersion3', type: 'UInt32', index: 48, description: 'Silverlight version 3' },
  { name: 'SilverlightVersion4', type: 'UInt16', index: 49, description: 'Silverlight version 4' },
  { name: 'PageCharset', type: 'String', index: 50, description: 'Page character set' },
  { name: 'CodeVersion', type: 'UInt32', index: 51, description: 'Code version' },
  { name: 'IsLink', type: 'UInt8', index: 52, description: 'Link click flag' },
  { name: 'IsDownload', type: 'UInt8', index: 53, description: 'Download flag' },
  { name: 'IsNotBounce', type: 'UInt8', index: 54, description: 'Not bounce flag' },
  { name: 'FUniqID', type: 'UInt64', index: 55, description: 'Fingerprint unique ID' },
  { name: 'OriginalURL', type: 'String', index: 56, description: 'Original URL' },
  { name: 'HID', type: 'UInt32', index: 57, description: 'Hit ID' },
  { name: 'IsOldCounter', type: 'UInt8', index: 58, description: 'Old counter flag' },
  { name: 'IsEvent', type: 'UInt8', index: 59, description: 'Event flag' },
  { name: 'IsParameter', type: 'UInt8', index: 60, description: 'Parameter flag' },
  { name: 'DontCountHits', type: 'UInt8', index: 61, description: 'Do not count hits flag' },
  { name: 'WithHash', type: 'UInt8', index: 62, description: 'With hash flag' },
  { name: 'HitColor', type: 'String', index: 63, description: 'Hit color' },
  { name: 'LocalEventTime', type: 'DateTime', index: 64, description: 'Local event timestamp' },
  { name: 'Age', type: 'UInt8', index: 65, description: 'User age' },
  { name: 'Sex', type: 'UInt8', index: 66, description: 'User sex' },
  { name: 'Income', type: 'UInt8', index: 67, description: 'User income level' },
  { name: 'Interests', type: 'UInt16', index: 68, description: 'User interests' },
  { name: 'Robotness', type: 'UInt8', index: 69, description: 'Robot probability' },
  { name: 'RemoteIP', type: 'UInt32', index: 70, description: 'Remote IP address' },
  { name: 'WindowName', type: 'Int32', index: 71, description: 'Window name' },
  { name: 'OpenerName', type: 'Int32', index: 72, description: 'Opener name' },
  { name: 'HistoryLength', type: 'Int16', index: 73, description: 'Browser history length' },
  { name: 'BrowserLanguage', type: 'String', index: 74, description: 'Browser language' },
  { name: 'BrowserCountry', type: 'String', index: 75, description: 'Browser country' },
  { name: 'SocialNetwork', type: 'String', index: 76, description: 'Social network' },
  { name: 'SocialAction', type: 'String', index: 77, description: 'Social action' },
  { name: 'HTTPError', type: 'UInt16', index: 78, description: 'HTTP error code' },
  { name: 'SendTiming', type: 'Int32', index: 79, description: 'Send timing' },
  { name: 'DNSTiming', type: 'Int32', index: 80, description: 'DNS timing' },
  { name: 'ConnectTiming', type: 'Int32', index: 81, description: 'Connect timing' },
  { name: 'ResponseStartTiming', type: 'Int32', index: 82, description: 'Response start timing' },
  { name: 'ResponseEndTiming', type: 'Int32', index: 83, description: 'Response end timing' },
  { name: 'FetchTiming', type: 'Int32', index: 84, description: 'Fetch timing' },
  { name: 'SocialSourceNetworkID', type: 'UInt8', index: 85, description: 'Social source network ID' },
  { name: 'SocialSourcePage', type: 'String', index: 86, description: 'Social source page' },
  { name: 'ParamPrice', type: 'Int64', index: 87, description: 'Parameter price' },
  { name: 'ParamOrderID', type: 'String', index: 88, description: 'Parameter order ID' },
  { name: 'ParamCurrency', type: 'String', index: 89, description: 'Parameter currency' },
  { name: 'ParamCurrencyID', type: 'UInt16', index: 90, description: 'Parameter currency ID' },
  { name: 'OpenstatServiceName', type: 'String', index: 91, description: 'Openstat service name' },
  { name: 'OpenstatCampaignID', type: 'String', index: 92, description: 'Openstat campaign ID' },
  { name: 'OpenstatAdID', type: 'String', index: 93, description: 'Openstat ad ID' },
  { name: 'OpenstatSourceID', type: 'String', index: 94, description: 'Openstat source ID' },
  { name: 'UTMSource', type: 'String', index: 95, description: 'UTM source' },
  { name: 'UTMMedium', type: 'String', index: 96, description: 'UTM medium' },
  { name: 'UTMCampaign', type: 'String', index: 97, description: 'UTM campaign' },
  { name: 'UTMContent', type: 'String', index: 98, description: 'UTM content' },
  { name: 'UTMTerm', type: 'String', index: 99, description: 'UTM term' },
  { name: 'FromTag', type: 'String', index: 100, description: 'From tag' },
  { name: 'HasGCLID', type: 'UInt8', index: 101, description: 'Has Google Click ID' },
  { name: 'RefererHash', type: 'UInt64', index: 102, description: 'Referrer hash' },
  { name: 'URLHash', type: 'UInt64', index: 103, description: 'URL hash' },
  { name: 'CLID', type: 'UInt32', index: 104, description: 'Click ID' },
];

/**
 * Column name to definition lookup
 */
export const HITS_COLUMNS_BY_NAME: Map<string, ColumnDefinition> = new Map(
  HITS_COLUMNS.map(col => [col.name, col])
);

/**
 * Get column definition by name (case-insensitive)
 */
export function getColumn(name: string): ColumnDefinition | undefined {
  // Try exact match first
  const exact = HITS_COLUMNS_BY_NAME.get(name);
  if (exact) return exact;

  // Try case-insensitive match
  const lowerName = name.toLowerCase();
  for (const col of HITS_COLUMNS) {
    if (col.name.toLowerCase() === lowerName) {
      return col;
    }
  }
  return undefined;
}

/**
 * Check if a column name exists in the schema
 */
export function hasColumn(name: string): boolean {
  return getColumn(name) !== undefined;
}

/**
 * Get all column names
 */
export function getColumnNames(): string[] {
  return HITS_COLUMNS.map(col => col.name);
}

// ============================================================================
// Table Metadata
// ============================================================================

/**
 * Hits table metadata
 */
export const HITS_TABLE_METADATA = {
  name: 'hits',
  database: 'default',
  engine: 'MergeTree',
  orderBy: ['CounterID', 'EventDate', 'UserID', 'EventTime', 'WatchID'],
  primaryKey: ['CounterID', 'EventDate', 'UserID', 'EventTime', 'WatchID'],
  columnCount: HITS_COLUMNS.length,
  /** Approximate row count in full dataset */
  approximateRowCount: 99997497,
  /** Approximate compressed size in bytes */
  approximateCompressedSize: 16 * 1024 * 1024 * 1024, // ~16GB
  /** Approximate uncompressed size in bytes */
  approximateUncompressedSize: 70 * 1024 * 1024 * 1024, // ~70GB
};

// ============================================================================
// CREATE TABLE Statement
// ============================================================================

/**
 * Generate CREATE TABLE statement for the hits table
 */
export function generateCreateTableStatement(): string {
  const columns = HITS_COLUMNS.map(col => {
    let typeDef: string = col.type;
    if (col.typeArgs) {
      typeDef = `${col.type}(${col.typeArgs})`;
    }
    return `    ${col.name} ${typeDef}`;
  }).join(',\n');

  return `CREATE TABLE IF NOT EXISTS hits
(
${columns}
)
ENGINE = MergeTree()
ORDER BY (${HITS_TABLE_METADATA.orderBy.join(', ')})`;
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Get the JavaScript type for a ClickHouse type
 */
export function getJSType(clickhouseType: ClickHouseType): 'number' | 'bigint' | 'string' | 'Date' | 'array' {
  switch (clickhouseType) {
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Float32':
    case 'Float64':
      return 'number';
    case 'UInt64':
    case 'Int64':
      return 'bigint';
    case 'String':
    case 'FixedString':
      return 'string';
    case 'Date':
    case 'DateTime':
      return 'Date';
    case 'Array':
      return 'array';
    default:
      return 'string';
  }
}

/**
 * Check if a type is numeric
 */
export function isNumericType(type: ClickHouseType): boolean {
  return ['UInt8', 'UInt16', 'UInt32', 'UInt64', 'Int8', 'Int16', 'Int32', 'Int64', 'Float32', 'Float64'].includes(type);
}

/**
 * Check if a type is a string type
 */
export function isStringType(type: ClickHouseType): boolean {
  return type === 'String' || type === 'FixedString';
}

/**
 * Check if a type is a date/time type
 */
export function isDateTimeType(type: ClickHouseType): boolean {
  return type === 'Date' || type === 'DateTime';
}
