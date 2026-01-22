/**
 * Extension Auto-Detection Module
 *
 * This module provides functionality to automatically detect which WASM extensions
 * are required based on SQL query analysis. It identifies function calls in SQL
 * queries and maps them to their corresponding extensions.
 *
 * Features:
 * - Parse SQL to extract function calls
 * - Map functions to their required extensions
 * - Handle case-insensitive function names
 * - Support for comments and string literal exclusion
 * - Built-in registry of geo, json, and crypto functions
 */

/**
 * Built-in function to extension mappings
 * Optimized with Object.freeze for immutability
 */
const BUILTIN_FUNCTION_MAP: Readonly<Record<string, string>> = Object.freeze({
  // Math extension functions (ext-math.wasm)
  sinh: 'ext-math',
  cosh: 'ext-math',
  tanh: 'ext-math',
  asinh: 'ext-math',
  acosh: 'ext-math',
  atanh: 'ext-math',
  atan2: 'ext-math',
  hypot: 'ext-math',
  log2: 'ext-math',
  log1p: 'ext-math',
  exp2: 'ext-math',
  exp10: 'ext-math',
  expm1: 'ext-math',
  lgamma: 'ext-math',
  tgamma: 'ext-math',
  factorial: 'ext-math',
  erf: 'ext-math',
  erfc: 'ext-math',
  cbrt: 'ext-math',
  gcd: 'ext-math',
  lcm: 'ext-math',
  intexp2: 'ext-math',
  intexp10: 'ext-math',
  bitand: 'ext-math',
  bitor: 'ext-math',
  bitxor: 'ext-math',
  bitnot: 'ext-math',
  bitshiftleft: 'ext-math',
  bitshiftright: 'ext-math',
  bitrotateleft: 'ext-math',
  bitrotateright: 'ext-math',
  bitcount: 'ext-math',
  bittest: 'ext-math',
  bittestall: 'ext-math',
  bittestany: 'ext-math',

  // Geo extension functions (ext-geo.wasm)
  h3togeo: 'ext-geo',
  h3togeoboundary: 'ext-geo',
  geotoh3: 'ext-geo',
  h3toparent: 'ext-geo',
  h3tochildren: 'ext-geo',
  h3hexagonring: 'ext-geo',
  h3distance: 'ext-geo',
  h3line: 'ext-geo',
  h3isvalid: 'ext-geo',
  h3getresolution: 'ext-geo',
  h3getbasecell: 'ext-geo',
  h3tostring: 'ext-geo',
  stringtoh3: 'ext-geo',
  h3indexestocells: 'ext-geo',
  h3iscell: 'ext-geo',
  h3ispentagon: 'ext-geo',
  h3cellstogeometry: 'ext-geo',
  h3tocenterchild: 'ext-geo',
  h3exactedgelength: 'ext-geo',
  h3numhexagons: 'ext-geo',
  h3kring: 'ext-geo',
  h3hexring: 'ext-geo',
  h3getfaces: 'ext-geo',
  geos2index: 'ext-geo',
  s2indextogeoboundary: 'ext-geo',
  s2togeo: 'ext-geo',
  geos2rect: 'ext-geo',
  s2captounion: 'ext-geo',
  s2recttocap: 'ext-geo',
  s2rectintersection: 'ext-geo',
  s2rectcontains: 'ext-geo',
  geodistance: 'ext-geo',
  greatcircledistance: 'ext-geo',
  greatcircleangle: 'ext-geo',
  pointinellipses: 'ext-geo',
  pointinpolygon: 'ext-geo',
  geopointspolygonarea: 'ext-geo',
  polygonareacartesian: 'ext-geo',
  polygonconvexhullcartesian: 'ext-geo',
  polygonperimetercartesian: 'ext-geo',
  polygonsintercartesian: 'ext-geo',
  polygonsunioncartesian: 'ext-geo',
  polygonssymmetricdiffcartesian: 'ext-geo',
  geohashesdecode: 'ext-geo',
  geohashesencode: 'ext-geo',
  geohashsinbox: 'ext-geo',
  geotogeohash: 'ext-geo',
  geohashtogeo: 'ext-geo',
  geounionrectangles: 'ext-geo',
  svg: 'ext-geo',
  svgwithcolors: 'ext-geo',

  // JSON extension functions (ext-json.wasm)
  jsonpath: 'ext-json',
  jsonextractstring: 'ext-json',
  jsonextractint: 'ext-json',
  jsonextractfloat: 'ext-json',
  jsonextractbool: 'ext-json',
  jsonextractarray: 'ext-json',
  jsonextractobject: 'ext-json',
  jsonextractraw: 'ext-json',
  jsonextractkeys: 'ext-json',
  jsonextractkeysandvalues: 'ext-json',
  jsonextractkeysandvaluesraw: 'ext-json',
  jsonextractarrayraw: 'ext-json',
  jsonextractuint: 'ext-json',
  jsonhas: 'ext-json',
  jsonlength: 'ext-json',
  jsontype: 'ext-json',
  jsondepth: 'ext-json',
  jsoncompact: 'ext-json',
  jsonmergepatch: 'ext-json',
  jsoninsert: 'ext-json',
  jsonremove: 'ext-json',
  jsonreplace: 'ext-json',
  jsonset: 'ext-json',
  tojsonstring: 'ext-json',
  jsoneachrow: 'ext-json',
  jsonobjectkeys: 'ext-json',
  parsejson: 'ext-json',
  jsonparsewithdefault: 'ext-json',
  simdjsonparse: 'ext-json',
  simdjsonhas: 'ext-json',
  simdjsonextract: 'ext-json',
  simdjsonextractsimple: 'ext-json',

  // Crypto extension functions (ext-crypto.wasm)
  encrypt: 'ext-crypto',
  decrypt: 'ext-crypto',
  aes_encrypt: 'ext-crypto',
  aes_decrypt: 'ext-crypto',
  aes_encrypt_mysql: 'ext-crypto',
  aes_decrypt_mysql: 'ext-crypto',
  sha1: 'ext-crypto',
  sha224: 'ext-crypto',
  sha256: 'ext-crypto',
  sha384: 'ext-crypto',
  sha512: 'ext-crypto',
  sha512_256: 'ext-crypto',
  sha3_224: 'ext-crypto',
  sha3_256: 'ext-crypto',
  sha3_384: 'ext-crypto',
  sha3_512: 'ext-crypto',
  keccak224: 'ext-crypto',
  keccak256: 'ext-crypto',
  keccak384: 'ext-crypto',
  keccak512: 'ext-crypto',
  blake2b: 'ext-crypto',
  blake2s: 'ext-crypto',
  blake3: 'ext-crypto',
  md4: 'ext-crypto',
  md5: 'ext-crypto',
  halfmd5: 'ext-crypto',
  xxhash32: 'ext-crypto',
  xxhash64: 'ext-crypto',
  xxh3: 'ext-crypto',
  siphash64: 'ext-crypto',
  siphash128: 'ext-crypto',
  siphash128reference: 'ext-crypto',
  siphash128keyed: 'ext-crypto',
  farmhash64: 'ext-crypto',
  farmfingerprint64: 'ext-crypto',
  javahash: 'ext-crypto',
  javahashutf16le: 'ext-crypto',
  hivehash: 'ext-crypto',
  hive_hash: 'ext-crypto',
  metrohash64: 'ext-crypto',
  murmurhash2_32: 'ext-crypto',
  murmurhash2_64: 'ext-crypto',
  murmurhash3_32: 'ext-crypto',
  murmurhash3_64: 'ext-crypto',
  murmurhash3_128: 'ext-crypto',
  cityhash64: 'ext-crypto',
  cityhash128: 'ext-crypto',
  crc32: 'ext-crypto',
  crc32ieee: 'ext-crypto',
  crc64: 'ext-crypto',
  hmac: 'ext-crypto',
  hmac_sha256: 'ext-crypto',
  hmac_sha512: 'ext-crypto',
  wordshingleminhash: 'ext-crypto',
  wordshingleminhashcaseinsensitive: 'ext-crypto',
  wordshingleminhashutf8: 'ext-crypto',
  ngramminhash: 'ext-crypto',
  ngramminhashcaseinsensitive: 'ext-crypto',
});

/**
 * Core ClickHouse functions that don't require extensions
 */
const CORE_FUNCTIONS = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'any',
  'anylast',
  'now',
  'today',
  'yesterday',
  'version',
  'tostring',
  'toint32',
  'toint64',
  'tofloat32',
  'tofloat64',
  'todate',
  'todatetime',
  'touint32',
  'touint64',
  'length',
  'lower',
  'upper',
  'concat',
  'substring',
  'trim',
  'if',
  'case',
  'coalesce',
  'ifnull',
  'nullif',
  'abs',
  'ceil',
  'floor',
  'round',
  'sqrt',
  'pow',
  'log',
  'log10',
  'exp',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'rand',
  'randnorm',
  'row_number',
  'rank',
  'dense_rank',
  'ntile',
  'lead',
  'lag',
  'first_value',
  'last_value',
  'array',
  'tuple',
  'map',
  'grouparray',
  'groupuniqarray',
  'arrayfilter',
  'arraymap',
  'arrayjoin',
  'arrayreduce',
  'hasall',
  'hasany',
  'has',
  'indexof',
  'empty',
  'notempty',
  'isnotnull',
  'isnull',
  'position',
  'like',
  'notlike',
  'match',
  'extract',
  'replaceone',
  'replaceall',
  'splitbychar',
  'splitbystring',
  'todate32',
  'formatdatetime',
  'parsedatetime',
  'todayofweek',
  'todayofmonth',
  'todayofyear',
  'tomonth',
  'toyear',
  'tohour',
  'tominute',
  'tosecond',
  'tostartofsecond',
  'tostartofminute',
  'tostartofhour',
  'tostartofday',
  'tostartofweek',
  'tostartofmonth',
  'tostartofquarter',
  'tostartofyear',
  'dateadd',
  'datesub',
  'datediff',
  'uniq',
  'uniqexact',
  'uniqhll12',
  'uniqcombined',
]);

/**
 * Registry for mapping functions to their required extensions.
 * Supports both built-in and custom registered functions.
 */
export class ExtensionFunctionRegistry {
  private functionToExtension: Map<string, string> = new Map();
  private extensionToFunctions: Map<string, Set<string>> = new Map();

  constructor() {
    // Initialize with built-in mappings
    this.initializeBuiltins();
  }

  /**
   * Initialize the registry with built-in function mappings
   */
  private initializeBuiltins(): void {
    for (const [func, ext] of Object.entries(BUILTIN_FUNCTION_MAP)) {
      this.functionToExtension.set(func, ext);
      if (!this.extensionToFunctions.has(ext)) {
        this.extensionToFunctions.set(ext, new Set());
      }
      this.extensionToFunctions.get(ext)!.add(func);
    }
  }

  /**
   * Register functions for an extension
   * @param extensionName - Name of the extension (e.g., 'ext-geo')
   * @param functions - Array of function names this extension provides
   */
  register(extensionName: string, functions: string[]): void {
    if (!this.extensionToFunctions.has(extensionName)) {
      this.extensionToFunctions.set(extensionName, new Set());
    }
    const extFunctions = this.extensionToFunctions.get(extensionName)!;

    for (const func of functions) {
      const lowerFunc = func.toLowerCase();
      this.functionToExtension.set(lowerFunc, extensionName);
      extFunctions.add(lowerFunc);
    }
  }

  /**
   * Get the extension that provides a given function
   * @param functionName - Name of the function
   * @returns Extension name or undefined if not found
   */
  getExtension(functionName: string): string | undefined {
    return this.functionToExtension.get(functionName.toLowerCase());
  }

  /**
   * Get all functions provided by an extension
   * @param extensionName - Name of the extension
   * @returns Array of function names
   */
  getFunctions(extensionName: string): string[] {
    const funcs = this.extensionToFunctions.get(extensionName);
    return funcs ? Array.from(funcs) : [];
  }

  /**
   * List all registered extensions
   * @returns Array of extension names
   */
  listExtensions(): string[] {
    return Array.from(this.extensionToFunctions.keys());
  }

  /**
   * Check if a function is registered
   * @param functionName - Name of the function
   * @returns True if registered
   */
  hasFunction(functionName: string): boolean {
    return this.functionToExtension.has(functionName.toLowerCase());
  }

  /**
   * Check if an extension is registered
   * @param extensionName - Name of the extension
   * @returns True if registered
   */
  hasExtension(extensionName: string): boolean {
    return this.extensionToFunctions.has(extensionName);
  }

  /**
   * Unregister an extension and all its functions
   * @param extensionName - Name of the extension
   */
  unregister(extensionName: string): void {
    const funcs = this.extensionToFunctions.get(extensionName);
    if (funcs) {
      for (const func of funcs) {
        this.functionToExtension.delete(func);
      }
      this.extensionToFunctions.delete(extensionName);
    }
  }

  /**
   * Clear all registrations (including built-ins)
   */
  clear(): void {
    this.functionToExtension.clear();
    this.extensionToFunctions.clear();
  }
}

// Global default registry instance
const defaultRegistry = new ExtensionFunctionRegistry();

/**
 * Remove SQL comments from a query string
 * Handles both single-line (--) and multi-line comments
 */
function removeComments(sql: string): string {
  // Remove single-line comments (-- style)
  let result = sql.replace(/--[^\n]*\n/g, '\n');
  result = result.replace(/--[^\n]*$/g, '');

  // Remove multi-line comments (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, ' ');

  return result;
}

/**
 * Remove single-quoted string literals from SQL to avoid false positives.
 * In SQL, single quotes are used for string literals.
 * Double quotes are used for identifiers (column/function names), so we keep them.
 */
function removeStringLiterals(sql: string): string {
  let result = '';
  let i = 0;
  let inSingleQuote = false;

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (!inSingleQuote) {
      if (char === "'") {
        inSingleQuote = true;
        result += ' ';
        i++;
        continue;
      }
      result += char;
    } else {
      if (char === "'" && nextChar === "'") {
        // Escaped single quote
        i += 2;
        continue;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      // Skip characters inside string literal
    }

    i++;
  }

  return result;
}

/**
 * Parse SQL to extract function calls
 * @param sql - SQL query string
 * @returns Array of function names found (lowercase for consistency)
 */
export function parseExtensionFunctions(sql: string): string[] {
  // Pre-process SQL to remove comments and string literals
  let cleanSql = removeComments(sql);
  cleanSql = removeStringLiterals(cleanSql);

  // Regex to find function calls: word followed by opening parenthesis
  // Handle backtick and double-quote quoted identifiers
  const functionPattern = /(?:[`"]?(\w+)[`"]?\s*\()/gi;

  const functions: Set<string> = new Set();
  let match: RegExpExecArray | null;

  while ((match = functionPattern.exec(cleanSql)) !== null) {
    const funcName = match[1].toLowerCase();
    functions.add(funcName);
  }

  return Array.from(functions);
}

/**
 * Get the extension required for a specific function
 * @param functionName - Name of the function
 * @returns Extension name or null if it's a core function or unknown
 */
export function getExtensionForFunction(functionName: string): string | null {
  const lowerName = functionName.toLowerCase();

  // Check if it's a core function (no extension needed)
  if (CORE_FUNCTIONS.has(lowerName)) {
    return null;
  }

  // Check the registry
  const ext = defaultRegistry.getExtension(lowerName);
  return ext ?? null;
}

/**
 * Detect which extensions are required for a SQL query
 * @param sql - SQL query string
 * @returns Array of unique extension names required
 */
export function detectRequiredExtensions(sql: string): string[] {
  if (!sql || sql.trim().length === 0) {
    return [];
  }

  const functions = parseExtensionFunctions(sql);
  const extensions: Set<string> = new Set();

  for (const func of functions) {
    const ext = getExtensionForFunction(func);
    if (ext) {
      extensions.add(ext);
    }
  }

  return Array.from(extensions);
}
