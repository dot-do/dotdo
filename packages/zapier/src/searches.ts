/**
 * Zapier Search Implementations
 *
 * Search actions for finding records in external services.
 */

import type {
  SearchConfig,
  SearchOperation,
  Bundle,
  ZObject,
  InputField,
  InputFieldOrFunction,
  OutputField,
  DisplayConfig,
} from './types'

// ============================================================================
// SEARCH CLASS
// ============================================================================

/**
 * Search definition helper
 */
export class Search {
  readonly config: SearchConfig

  constructor(config: SearchConfig) {
    this.config = config
  }

  get key(): string {
    return this.config.key
  }

  get noun(): string {
    return this.config.noun
  }

  get display(): DisplayConfig {
    return this.config.display
  }

  get operation(): SearchOperation {
    return this.config.operation
  }

  get searchOrCreateKey(): string | undefined {
    return this.config.searchOrCreateKey
  }

  /**
   * Execute the search's perform function
   */
  async perform(z: ZObject, bundle: Bundle): Promise<unknown[]> {
    return this.config.operation.perform(z, bundle)
  }

  /**
   * Get sample data for the search
   */
  getSample(): Record<string, unknown> | undefined {
    return this.config.operation.sample
  }

  /**
   * Resolve input fields (handles dynamic fields)
   */
  async resolveInputFields(z: ZObject, bundle: Bundle): Promise<InputField[]> {
    const fields = this.config.operation.inputFields || []
    const resolvedFields: InputField[] = []

    for (const field of fields) {
      if (typeof field === 'function') {
        const dynamicFields = await field(z, bundle)
        resolvedFields.push(...dynamicFields)
      } else {
        resolvedFields.push(field)
      }
    }

    return resolvedFields
  }

  /**
   * Get output fields
   */
  getOutputFields(): OutputField[] {
    return this.config.operation.outputFields || []
  }

  /**
   * Check if this search has a linked create action
   */
  hasCreateFallback(): boolean {
    return !!this.config.searchOrCreateKey
  }

  /**
   * Execute search and optionally create if not found
   */
  async searchOrCreate(
    z: ZObject,
    bundle: Bundle,
    createFn?: (z: ZObject, bundle: Bundle) => Promise<unknown>
  ): Promise<unknown> {
    const results = await this.perform(z, bundle)

    if (results.length > 0) {
      return results[0]
    }

    if (createFn) {
      return createFn(z, bundle)
    }

    return null
  }
}

// ============================================================================
// SEARCH BUILDER
// ============================================================================

/**
 * Create a search configuration
 */
export function createSearch(config: {
  key: string
  noun: string
  display: DisplayConfig
  perform: (z: ZObject, bundle: Bundle) => Promise<unknown[]>
  inputFields?: InputFieldOrFunction[]
  outputFields?: OutputField[]
  sample?: Record<string, unknown>
  searchOrCreateKey?: string
}): SearchConfig {
  return {
    key: config.key,
    noun: config.noun,
    display: config.display,
    operation: {
      perform: config.perform,
      inputFields: config.inputFields,
      outputFields: config.outputFields,
      sample: config.sample,
    },
    searchOrCreateKey: config.searchOrCreateKey,
  }
}

/**
 * Fluent builder for creating searches
 */
export class SearchBuilder {
  private config: Partial<SearchConfig> = {}
  private inputFieldsList: InputFieldOrFunction[] = []
  private outputFieldsList: OutputField[] = []

  key(key: string): this {
    this.config.key = key
    return this
  }

  noun(noun: string): this {
    this.config.noun = noun
    return this
  }

  display(display: DisplayConfig): this {
    this.config.display = display
    return this
  }

  label(label: string): this {
    if (!this.config.display) {
      this.config.display = { label, description: '' }
    } else {
      this.config.display.label = label
    }
    return this
  }

  description(description: string): this {
    if (!this.config.display) {
      this.config.display = { label: '', description }
    } else {
      this.config.display.description = description
    }
    return this
  }

  perform(fn: (z: ZObject, bundle: Bundle) => Promise<unknown[]>): this {
    if (!this.config.operation) {
      this.config.operation = {} as SearchOperation
    }
    this.config.operation.perform = fn
    return this
  }

  inputField(field: InputField): this {
    this.inputFieldsList.push(field)
    return this
  }

  dynamicInputFields(
    fn: (z: ZObject, bundle: Bundle) => Promise<InputField[]>
  ): this {
    this.inputFieldsList.push(fn)
    return this
  }

  inputFields(fields: InputFieldOrFunction[]): this {
    this.inputFieldsList.push(...fields)
    return this
  }

  outputField(field: OutputField): this {
    this.outputFieldsList.push(field)
    return this
  }

  outputFields(fields: OutputField[]): this {
    this.outputFieldsList.push(...fields)
    return this
  }

  sample(sample: Record<string, unknown>): this {
    if (!this.config.operation) {
      this.config.operation = {} as SearchOperation
    }
    this.config.operation.sample = sample
    return this
  }

  searchOrCreateKey(key: string): this {
    this.config.searchOrCreateKey = key
    return this
  }

  build(): SearchConfig {
    if (!this.config.key) {
      throw new Error('Search key is required')
    }
    if (!this.config.noun) {
      throw new Error('Search noun is required')
    }
    if (!this.config.display) {
      throw new Error('Search display is required')
    }
    if (!this.config.operation?.perform) {
      throw new Error('Search perform function is required')
    }

    // Attach input/output fields
    this.config.operation.inputFields = this.inputFieldsList
    this.config.operation.outputFields = this.outputFieldsList

    return this.config as SearchConfig
  }
}

/**
 * Start building a search
 */
export function search(): SearchBuilder {
  return new SearchBuilder()
}

// ============================================================================
// SEARCH UTILITIES
// ============================================================================

/**
 * Create a simple ID-based search
 */
export function createIdSearch(config: {
  key: string
  noun: string
  baseUrl: string
  idParam?: string
  label?: string
  description?: string
}): SearchConfig {
  const idParam = config.idParam || 'id'

  return createSearch({
    key: config.key,
    noun: config.noun,
    display: {
      label: config.label || `Find ${config.noun}`,
      description:
        config.description || `Finds a ${config.noun.toLowerCase()} by ID`,
    },
    inputFields: [
      {
        key: idParam,
        label: `${config.noun} ID`,
        type: 'string',
        required: true,
        helpText: `The ID of the ${config.noun.toLowerCase()} to find`,
      },
    ],
    perform: async (z, bundle) => {
      const id = bundle.inputData[idParam]
      const response = await z.request({
        url: `${config.baseUrl}/${id}`,
        method: 'GET',
      })

      // Return as array (search always returns array)
      if (response.data) {
        return [response.data]
      }
      return []
    },
  })
}

/**
 * Create a field-based search
 */
export function createFieldSearch(config: {
  key: string
  noun: string
  baseUrl: string
  searchFields: Array<{
    key: string
    label: string
    required?: boolean
  }>
  label?: string
  description?: string
}): SearchConfig {
  return createSearch({
    key: config.key,
    noun: config.noun,
    display: {
      label: config.label || `Find ${config.noun}`,
      description:
        config.description || `Searches for ${config.noun.toLowerCase()}s`,
    },
    inputFields: config.searchFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: 'string' as const,
      required: f.required,
    })),
    perform: async (z, bundle) => {
      const params: Record<string, string> = {}

      for (const field of config.searchFields) {
        const value = bundle.inputData[field.key]
        if (value !== undefined && value !== null && value !== '') {
          params[field.key] = String(value)
        }
      }

      const response = await z.request({
        url: config.baseUrl,
        method: 'GET',
        params,
      })

      const data = response.data
      if (Array.isArray(data)) {
        return data
      }
      if (data) {
        return [data]
      }
      return []
    },
  })
}

/**
 * Filter search results client-side
 */
export function filterSearchResults<T extends Record<string, unknown>>(
  results: T[],
  filters: Record<string, unknown>
): T[] {
  return results.filter((item) => {
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') {
        continue
      }

      const itemValue = item[key]

      // String comparison (case-insensitive contains)
      if (typeof itemValue === 'string' && typeof value === 'string') {
        if (!itemValue.toLowerCase().includes(value.toLowerCase())) {
          return false
        }
      }
      // Exact match for other types
      else if (itemValue !== value) {
        return false
      }
    }
    return true
  })
}

/**
 * Sort search results
 */
export function sortSearchResults<T extends Record<string, unknown>>(
  results: T[],
  sortField: string,
  order: 'asc' | 'desc' = 'asc'
): T[] {
  return [...results].sort((a, b) => {
    const aValue = a[sortField]
    const bValue = b[sortField]

    let comparison = 0

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
      comparison = aValue - bValue
    } else if (aValue instanceof Date && bValue instanceof Date) {
      comparison = aValue.getTime() - bValue.getTime()
    }

    return order === 'desc' ? -comparison : comparison
  })
}

/**
 * Paginate search results
 */
export function paginateSearchResults<T>(
  results: T[],
  page = 1,
  limit = 20
): { items: T[]; total: number; page: number; totalPages: number } {
  const total = results.length
  const totalPages = Math.ceil(total / limit)
  const start = (page - 1) * limit
  const items = results.slice(start, start + limit)

  return { items, total, page, totalPages }
}

/**
 * Create search result with metadata
 */
export function createSearchResult<T extends Record<string, unknown>>(
  items: T[],
  options?: {
    query?: Record<string, unknown>
    page?: number
    limit?: number
    totalCount?: number
  }
): {
  items: T[]
  metadata: {
    query?: Record<string, unknown>
    page: number
    limit: number
    count: number
    totalCount?: number
  }
} {
  return {
    items,
    metadata: {
      query: options?.query,
      page: options?.page ?? 1,
      limit: options?.limit ?? items.length,
      count: items.length,
      totalCount: options?.totalCount,
    },
  }
}
