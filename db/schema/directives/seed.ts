/**
 * $seed Directive Handler
 *
 * Processes the $seed directive which populates entities from external data sources.
 */

import { extractId, extractPath } from './id-extraction'
import { parseCSV, parseTSV, parseJSON, parseJSONL, parseXML, parseYAML } from './parsers'

export type SeedFormat = 'csv' | 'tsv' | 'json' | 'jsonl' | 'xml' | 'yaml'

export interface PaginationConfig {
  type?: 'cursor' | 'offset' | 'page' | 'link-header'
  nextPath?: string
  dataPath?: string
  param?: string
  limit?: number
  totalPath?: string
  rel?: string
  totalPages?: string
}

export interface SeedConfig {
  url: string
  format: SeedFormat
  idField?: string
  headers?: Record<string, string>
  transform?: string | ((rows: unknown[]) => unknown[])
  pagination: PaginationConfig
  maxPages?: number
  mapping?: Record<string, string>
  retry?: {
    maxRetries?: number
    backoff?: 'linear' | 'exponential'
  }
}

export interface Entity {
  $id: string
  $type?: string
  [key: string]: unknown
}

export interface SeedOptions {
  typeName?: string
}

/**
 * Detect format from URL extension
 */
export function detectFormat(url: string | null, contentType?: string | null, content?: string | null): SeedFormat {
  // Try content-type header first
  if (contentType) {
    const type = contentType.split(';')[0].trim().toLowerCase()
    if (type === 'text/csv' || type === 'application/csv') return 'csv'
    if (type === 'text/tab-separated-values') return 'tsv'
    if (type === 'application/json' || type === 'text/json') return 'json'
    if (type === 'application/xml' || type === 'text/xml') return 'xml'
    if (type === 'text/yaml' || type === 'application/yaml' || type === 'application/x-yaml') return 'yaml'
  }

  // Try URL extension
  if (url) {
    // Remove query string and fragment
    const cleanUrl = url.split('?')[0].split('#')[0]
    const ext = cleanUrl.split('.').pop()?.toLowerCase()

    if (ext === 'csv') return 'csv'
    if (ext === 'tsv') return 'tsv'
    if (ext === 'json') return 'json'
    if (ext === 'jsonl' || ext === 'ndjson') return 'jsonl'
    if (ext === 'xml') return 'xml'
    if (ext === 'yaml' || ext === 'yml') return 'yaml'
  }

  // Try content sniffing
  if (content) {
    const trimmed = content.trim()

    // JSON starts with [ or {
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'

    // XML starts with <?xml or <
    if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.includes('</'))) return 'xml'

    // YAML often starts with ---
    if (trimmed.startsWith('---')) return 'yaml'

    // CSV typically has commas and newlines with a header row
    if (trimmed.includes(',') && trimmed.includes('\n')) {
      const lines = trimmed.split('\n')
      if (lines.length >= 2) {
        const firstLineCommas = (lines[0].match(/,/g) || []).length
        const secondLineCommas = (lines[1].match(/,/g) || []).length
        if (firstLineCommas > 0 && firstLineCommas === secondLineCommas) {
          return 'csv'
        }
      }
    }
  }

  // Default to JSON
  return 'json'
}

/**
 * Parse the $seed configuration from string or object format
 */
export function parseSeedConfig(seed: string | Record<string, unknown>): SeedConfig {
  if (typeof seed === 'string') {
    const format = detectFormat(seed)
    return {
      url: seed,
      format,
      pagination: {},
    }
  }

  const url = seed.url as string
  const format = (seed.format as SeedFormat) || detectFormat(url)

  // Parse pagination config
  const pagination: PaginationConfig = {}

  if (seed.$data) {
    pagination.dataPath = seed.$data as string
  }

  if (seed.$next) {
    if (typeof seed.$next === 'string') {
      pagination.nextPath = seed.$next
      pagination.type = 'cursor'
    } else if (typeof seed.$next === 'object') {
      const nextConfig = seed.$next as Record<string, unknown>
      pagination.type = nextConfig.type as PaginationConfig['type']
      pagination.param = nextConfig.param as string
      pagination.limit = nextConfig.limit as number
      pagination.totalPath = nextConfig.total as string
      pagination.totalPages = nextConfig.totalPages as string
      pagination.rel = nextConfig.rel as string
    }
  }

  return {
    url,
    format,
    idField: seed.idField as string,
    headers: seed.headers as Record<string, string>,
    transform: seed.transform as string | ((rows: unknown[]) => unknown[]),
    pagination,
    maxPages: seed.maxPages as number,
    mapping: seed.mapping as Record<string, string>,
    retry: seed.retry as SeedConfig['retry'],
  }
}

/**
 * Parse raw data based on format
 */
function parseData(content: string, format: SeedFormat, dataPath?: string): unknown[] {
  switch (format) {
    case 'csv':
      return parseCSV(content)
    case 'tsv':
      return parseTSV(content)
    case 'json':
      return parseJSON(content, { dataPath })
    case 'jsonl':
      return parseJSONL(content)
    case 'xml':
      return parseXML(content)
    case 'yaml':
      return parseYAML(content, { dataPath: dataPath?.replace(/^\$\./, '') })
    default:
      return parseJSON(content, { dataPath })
  }
}

/**
 * Parse Link header to extract URLs by rel
 */
function parseLinkHeader(header: string): Record<string, string> {
  const links: Record<string, string> = {}
  const parts = header.split(',')

  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/)
    if (match) {
      links[match[2]] = match[1]
    }
  }

  return links
}

/**
 * Extract pagination info from response
 */
export function extractPaginationInfo(
  response: unknown,
  config: { pagination: PaginationConfig; currentOffset?: number },
  headers?: Headers
): { cursor?: string; offset?: number; url?: string; hasMore: boolean } {
  const { pagination, currentOffset = 0 } = config

  if (pagination.type === 'link-header') {
    if (headers) {
      const linkHeader = headers.get('Link')
      if (linkHeader) {
        const links = parseLinkHeader(linkHeader)
        const nextUrl = links[pagination.rel || 'next']
        return {
          url: nextUrl,
          hasMore: !!nextUrl,
        }
      }
    }
    return { hasMore: false }
  }

  if (pagination.type === 'offset') {
    if (response && typeof response === 'object') {
      const total = pagination.totalPath ? (extractPath(response, pagination.totalPath) as number) : 0

      const limit = pagination.limit || 10
      const nextOffset = currentOffset + limit
      return {
        offset: nextOffset,
        hasMore: nextOffset < total,
      }
    }
    return { hasMore: false }
  }

  // Cursor pagination (default)
  if (pagination.nextPath && response) {
    const cursor = extractPath(response, pagination.nextPath) as string | null
    return {
      cursor: cursor || undefined,
      hasMore: !!cursor,
    }
  }

  return { hasMore: false }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch seed data from URL, handling pagination
 */
export async function fetchSeedData(config: SeedConfig): Promise<unknown[]> {
  const allData: unknown[] = []
  let url = config.url
  let pageCount = 0
  let currentOffset = 0

  while (url && (config.maxPages === undefined || pageCount < config.maxPages)) {
    const fetchUrl = config.pagination.type === 'offset' && currentOffset > 0 ? `${url}?${config.pagination.param}=${currentOffset}` : url

    let response: Response
    let retries = 0
    const maxRetries = config.retry?.maxRetries || 0

    while (true) {
      try {
        response = await fetch(fetchUrl, {
          headers: config.headers || {},
        })

        if (response.ok) break

        if (response.status === 429 && retries < maxRetries) {
          const retryAfter = response.headers.get('Retry-After')
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, retries) * 1000
          await sleep(waitTime)
          retries++
          continue
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      } catch (error) {
        if (retries < maxRetries) {
          await sleep(Math.pow(2, retries) * 1000)
          retries++
          continue
        }
        throw error
      }
    }

    const content = await response.text()
    const dataPath = config.pagination.dataPath

    let data: unknown[]
    let parsedResponse: unknown

    // For pagination, we need to parse the full response to extract pagination info
    if (config.format === 'json' && dataPath) {
      parsedResponse = JSON.parse(content)
      data = (extractPath(parsedResponse, dataPath) as unknown[]) || []
    } else {
      data = parseData(content, config.format, dataPath)
      parsedResponse = config.format === 'json' ? JSON.parse(content) : data
    }

    allData.push(...data)
    pageCount++

    // Check for more pages
    const paginationInfo = extractPaginationInfo(parsedResponse, { pagination: config.pagination, currentOffset }, response.headers)

    if (!paginationInfo.hasMore) break

    if (paginationInfo.url) {
      url = paginationInfo.url
    } else if (paginationInfo.cursor) {
      // For cursor pagination, add cursor to URL
      const separator = url.includes('?') ? '&' : '?'
      url = `${config.url}${separator}cursor=${paginationInfo.cursor}`
    } else if (paginationInfo.offset !== undefined) {
      currentOffset = paginationInfo.offset
    } else {
      break
    }
  }

  return allData
}

/**
 * Generate a unique ID for entities without an ID field
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Coerce a value to the specified type
 */
function coerceValue(value: unknown, targetType: string): unknown {
  if (value === undefined || value === null) return value

  switch (targetType) {
    case 'number':
      const num = typeof value === 'string' ? parseFloat(value) : value
      return typeof num === 'number' && !isNaN(num) ? num : value

    case 'boolean':
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
      }
      return value

    case 'date':
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        return isNaN(date.getTime()) ? value : date
      }
      return value

    default:
      return value
  }
}

/**
 * Create an entity from a seed data row
 */
export function createEntityFromSeed(row: Record<string, unknown>, type: Record<string, unknown>, options: SeedOptions = {}): Entity {
  const seedConfig = type.$seed as Record<string, unknown>
  const idField = seedConfig?.idField as string | undefined

  // Extract or generate ID
  let id: string
  if (idField) {
    // If idField contains a transform function or already starts with $., use as-is
    // Otherwise, prepend $.
    const isTransform = /^[a-zA-Z]+\(/.test(idField)
    const isJsonPath = idField.startsWith('$.')
    const pattern = isTransform || isJsonPath ? idField : `$.${idField}`
    const extracted = extractId(row, pattern)
    id = extracted ? String(extracted) : generateId()
  } else {
    id = generateId()
  }

  // Create base entity
  const entity: Entity = {
    $id: id,
  }

  // Set type if provided
  if (options.typeName) {
    entity.$type = options.typeName
  }

  // Apply field mapping if specified
  const mapping = seedConfig?.mapping as Record<string, string> | undefined

  if (mapping) {
    for (const [field, path] of Object.entries(mapping)) {
      const value = extractPath(row, path)
      if (value !== undefined) {
        entity[field] = value
      }
    }
  } else {
    // Copy all fields from row
    for (const [key, value] of Object.entries(row)) {
      entity[key] = value
    }
  }

  // Apply type coercion based on schema
  for (const [field, fieldType] of Object.entries(type)) {
    if (field.startsWith('$')) continue

    const targetType = typeof fieldType === 'string' ? fieldType : (fieldType as Record<string, unknown>)?.type

    if (typeof targetType === 'string' && entity[field] !== undefined) {
      entity[field] = coerceValue(entity[field], targetType)
    }
  }

  return entity
}

/**
 * Process the $seed directive on a type to fetch and create entities
 */
export async function processSeedDirective(type: Record<string, unknown>, options: SeedOptions = {}): Promise<Entity[]> {
  const seed = type.$seed

  if (!seed) {
    return []
  }

  const config = parseSeedConfig(seed as string | Record<string, unknown>)

  // Validate URL
  try {
    new URL(config.url)
  } catch {
    throw new Error(`Invalid URL: ${config.url}`)
  }

  // Fetch data
  let data: unknown[]
  try {
    data = await fetchSeedData(config)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse response: ${error.message}`)
    }
    throw error
  }

  // Apply transform if specified
  if (config.transform && typeof config.transform === 'function') {
    data = config.transform(data)
  }

  // Create entities
  const entities: Entity[] = []
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown>
    try {
      const entity = createEntityFromSeed(row, type, options)
      entities.push(entity)
    } catch (error) {
      throw new Error(`Error processing row ${i + 2}: ${(error as Error).message}`)
    }
  }

  return entities
}
