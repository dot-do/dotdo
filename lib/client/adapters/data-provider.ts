/**
 * React-Admin DataProvider Adapter
 *
 * Creates a DataProvider that implements react-admin's data interface
 * for dotdo backends using RPC.
 *
 * @see https://marmelab.com/react-admin/DataProviderIntroduction.html
 *
 * ## Usage
 *
 * ```tsx
 * import { createDataProvider } from '@dotdo/client/adapters/data-provider'
 *
 * const dataProvider = createDataProvider('https://api.example.com.ai', {
 *   headers: { 'X-Custom-Header': 'value' },
 *   auth: { token: 'jwt-token' },
 * })
 *
 * // Use with react-admin
 * <Admin dataProvider={dataProvider}>
 *   <Resource name="posts" list={PostList} />
 * </Admin>
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type Identifier = string | number

export interface RaRecord {
  id: Identifier
  [key: string]: unknown
}

export interface SortPayload {
  field: string
  order: 'ASC' | 'DESC'
}

export interface PaginationPayload {
  page: number
  perPage: number
}

export interface FilterPayload {
  [key: string]: unknown
}

export interface GetListParams {
  pagination: PaginationPayload
  sort: SortPayload
  filter: FilterPayload
  meta?: Record<string, unknown>
}

export interface GetOneParams {
  id: Identifier
  meta?: Record<string, unknown>
}

export interface GetManyParams {
  ids: Identifier[]
  meta?: Record<string, unknown>
}

export interface GetManyReferenceParams {
  target: string
  id: Identifier
  pagination: PaginationPayload
  sort: SortPayload
  filter: FilterPayload
  meta?: Record<string, unknown>
}

export interface CreateParams<T = RaRecord> {
  data: Partial<T>
  meta?: Record<string, unknown>
}

export interface UpdateParams<T = RaRecord> {
  id: Identifier
  data: Partial<T>
  previousData: T
  meta?: Record<string, unknown>
}

export interface UpdateManyParams<T = Partial<RaRecord>> {
  ids: Identifier[]
  data: T
  meta?: Record<string, unknown>
}

export interface DeleteParams<T = RaRecord> {
  id: Identifier
  previousData?: T
  meta?: Record<string, unknown>
}

export interface DeleteManyParams {
  ids: Identifier[]
  meta?: Record<string, unknown>
}

export interface GetListResult<T = RaRecord> {
  data: T[]
  total: number
  pageInfo?: {
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

export interface GetOneResult<T = RaRecord> {
  data: T
}

export interface GetManyResult<T = RaRecord> {
  data: T[]
}

export interface GetManyReferenceResult<T = RaRecord> {
  data: T[]
  total: number
  pageInfo?: {
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

export interface CreateResult<T = RaRecord> {
  data: T
}

export interface UpdateResult<T = RaRecord> {
  data: T
}

export interface UpdateManyResult {
  data: Identifier[]
}

export interface DeleteResult<T = RaRecord> {
  data: T
}

export interface DeleteManyResult {
  data: Identifier[]
}

export interface DataProvider {
  getList: <T extends RaRecord = RaRecord>(
    resource: string,
    params: GetListParams
  ) => Promise<GetListResult<T>>
  getOne: <T extends RaRecord = RaRecord>(
    resource: string,
    params: GetOneParams
  ) => Promise<GetOneResult<T>>
  getMany: <T extends RaRecord = RaRecord>(
    resource: string,
    params: GetManyParams
  ) => Promise<GetManyResult<T>>
  getManyReference: <T extends RaRecord = RaRecord>(
    resource: string,
    params: GetManyReferenceParams
  ) => Promise<GetManyReferenceResult<T>>
  create: <T extends RaRecord = RaRecord>(
    resource: string,
    params: CreateParams<T>
  ) => Promise<CreateResult<T>>
  update: <T extends RaRecord = RaRecord>(
    resource: string,
    params: UpdateParams<T>
  ) => Promise<UpdateResult<T>>
  updateMany: <T extends RaRecord = RaRecord>(
    resource: string,
    params: UpdateManyParams<T>
  ) => Promise<UpdateManyResult>
  delete: <T extends RaRecord = RaRecord>(
    resource: string,
    params: DeleteParams<T>
  ) => Promise<DeleteResult<T>>
  deleteMany: (
    resource: string,
    params: DeleteManyParams
  ) => Promise<DeleteManyResult>
}

// =============================================================================
// DataProviderError
// =============================================================================

export class DataProviderError extends Error {
  public status: number
  public resource: string
  public previousData?: RaRecord

  constructor(
    message: string,
    status: number,
    resource: string,
    previousData?: RaRecord
  ) {
    super(message)
    this.name = 'DataProviderError'
    this.status = status
    this.resource = resource
    this.previousData = previousData
  }
}

// =============================================================================
// Options
// =============================================================================

export interface DataProviderOptions {
  /** Custom headers to include in all requests */
  headers?: Record<string, string>
  /** Auth configuration */
  auth?: {
    token: string
  }
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

// =============================================================================
// Config Types
// =============================================================================

/**
 * Configuration object for createDataProvider
 */
export interface DataProviderConfig {
  /** Base URL of the dotdo backend */
  baseUrl: string
  /** Custom headers to include in all requests */
  headers?: Record<string, string>
  /** Auth configuration */
  auth?: {
    token: string
  }
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a react-admin DataProvider for dotdo backends
 *
 * @param config - Configuration object with baseUrl
 * @returns DataProvider instance
 */
export function createDataProvider(config: DataProviderConfig): DataProvider
/**
 * Creates a react-admin DataProvider for dotdo backends
 *
 * @param doUrl - Base URL of the dotdo backend
 * @param options - Configuration options
 * @returns DataProvider instance
 */
export function createDataProvider(
  doUrl: string,
  options?: DataProviderOptions
): DataProvider
export function createDataProvider(
  configOrUrl: string | DataProviderConfig,
  options?: DataProviderOptions
): DataProvider {
  // Normalize to get baseUrl and options
  const baseUrl = typeof configOrUrl === 'string'
    ? configOrUrl.replace(/\/+$/, '')
    : configOrUrl.baseUrl.replace(/\/+$/, '')

  const opts: DataProviderOptions = typeof configOrUrl === 'string'
    ? (options ?? {})
    : {
        headers: configOrUrl.headers,
        auth: configOrUrl.auth,
        fetch: configOrUrl.fetch,
      }

  const fetchFn = opts.fetch ?? globalThis.fetch

  // Build headers
  const getHeaders = (): HeadersInit => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (opts.headers) {
      Object.assign(headers, opts.headers)
    }

    if (opts.auth?.token) {
      headers['Authorization'] = `Bearer ${opts.auth.token}`
    }

    return headers
  }

  // Make a request and handle errors
  const request = async <T>(
    url: string,
    init?: RequestInit,
    resource?: string,
    previousData?: RaRecord
  ): Promise<T> => {
    let response: Response

    try {
      response = await fetchFn(url, {
        ...init,
        headers: {
          ...getHeaders(),
          ...(init?.headers ?? {}),
        },
      })
    } catch (error) {
      // Network error
      throw error
    }

    let json: unknown

    try {
      json = await response.json()
    } catch {
      throw new DataProviderError(
        'Invalid JSON response',
        response.status,
        resource ?? 'unknown',
        previousData
      )
    }

    if (!response.ok) {
      const errorMessage = (json as { error?: string })?.error ??
        response.statusText ??
        `HTTP ${response.status}`
      throw new DataProviderError(
        errorMessage,
        response.status,
        resource ?? 'unknown',
        previousData
      )
    }

    return json as T
  }

  // Build URL with query params
  const buildUrl = (resource: string, params?: Record<string, string>): string => {
    const url = new URL(`${baseUrl}/${resource}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }
    return url.toString()
  }

  return {
    // =========================================================================
    // getList
    // =========================================================================
    async getList<T extends RaRecord = RaRecord>(
      resource: string,
      params: GetListParams
    ): Promise<GetListResult<T>> {
      const { pagination, sort, filter } = params

      const queryParams: Record<string, string> = {
        page: String(pagination.page),
        perPage: String(pagination.perPage),
        sort: sort.field,
        order: sort.order,
      }

      // Add filter params
      if (Object.keys(filter).length > 0) {
        queryParams.filter = JSON.stringify(filter)
      }

      const url = buildUrl(resource, queryParams)

      const response = await request<{
        data: T[]
        total: number
        pageInfo?: { hasNextPage: boolean; hasPreviousPage: boolean }
      }>(url, { method: 'GET' }, resource)

      return {
        data: response.data,
        total: response.total,
        pageInfo: response.pageInfo,
      }
    },

    // =========================================================================
    // getOne
    // =========================================================================
    async getOne<T extends RaRecord = RaRecord>(
      resource: string,
      params: GetOneParams
    ): Promise<GetOneResult<T>> {
      const url = buildUrl(`${resource}/${params.id}`)

      const response = await request<{ data: T }>(
        url,
        { method: 'GET' },
        resource
      )

      return { data: response.data }
    },

    // =========================================================================
    // getMany
    // =========================================================================
    async getMany<T extends RaRecord = RaRecord>(
      resource: string,
      params: GetManyParams
    ): Promise<GetManyResult<T>> {
      if (params.ids.length === 0) {
        return { data: [] }
      }

      const queryParams: Record<string, string> = {
        ids: JSON.stringify(params.ids),
      }

      const url = buildUrl(resource, queryParams)

      const response = await request<{ data: T[] }>(
        url,
        { method: 'GET' },
        resource
      )

      return { data: response.data }
    },

    // =========================================================================
    // getManyReference
    // =========================================================================
    async getManyReference<T extends RaRecord = RaRecord>(
      resource: string,
      params: GetManyReferenceParams
    ): Promise<GetManyReferenceResult<T>> {
      const { target, id, pagination, sort, filter } = params

      // Merge the foreign key filter with other filters
      const combinedFilter = {
        ...filter,
        [target]: id,
      }

      const queryParams: Record<string, string> = {
        page: String(pagination.page),
        perPage: String(pagination.perPage),
        sort: sort.field,
        order: sort.order,
        filter: JSON.stringify(combinedFilter),
      }

      const url = buildUrl(resource, queryParams)

      const response = await request<{
        data: T[]
        total: number
        pageInfo?: { hasNextPage: boolean; hasPreviousPage: boolean }
      }>(url, { method: 'GET' }, resource)

      return {
        data: response.data,
        total: response.total,
        pageInfo: response.pageInfo,
      }
    },

    // =========================================================================
    // create
    // =========================================================================
    async create<T extends RaRecord = RaRecord>(
      resource: string,
      params: CreateParams<T>
    ): Promise<CreateResult<T>> {
      const url = buildUrl(resource)

      const response = await request<{ data: T }>(
        url,
        {
          method: 'POST',
          body: JSON.stringify(params.data),
        },
        resource
      )

      return { data: response.data }
    },

    // =========================================================================
    // update
    // =========================================================================
    async update<T extends RaRecord = RaRecord>(
      resource: string,
      params: UpdateParams<T>
    ): Promise<UpdateResult<T>> {
      const url = buildUrl(`${resource}/${params.id}`)

      const response = await request<{ data: T }>(
        url,
        {
          method: 'PUT',
          body: JSON.stringify(params.data),
        },
        resource,
        params.previousData as RaRecord
      )

      return { data: response.data }
    },

    // =========================================================================
    // updateMany
    // =========================================================================
    async updateMany<T extends RaRecord = RaRecord>(
      resource: string,
      params: UpdateManyParams<T>
    ): Promise<UpdateManyResult> {
      const url = buildUrl(resource)

      const response = await request<{ data: Identifier[] }>(
        url,
        {
          method: 'PUT',
          body: JSON.stringify({
            ids: params.ids,
            data: params.data,
          }),
        },
        resource
      )

      return { data: response.data }
    },

    // =========================================================================
    // delete
    // =========================================================================
    async delete<T extends RaRecord = RaRecord>(
      resource: string,
      params: DeleteParams<T>
    ): Promise<DeleteResult<T>> {
      const url = buildUrl(`${resource}/${params.id}`)

      const response = await request<{ data: T }>(
        url,
        { method: 'DELETE' },
        resource
      )

      return { data: response.data }
    },

    // =========================================================================
    // deleteMany
    // =========================================================================
    async deleteMany(
      resource: string,
      params: DeleteManyParams
    ): Promise<DeleteManyResult> {
      const url = buildUrl(resource)

      const response = await request<{ data: Identifier[] }>(
        url,
        {
          method: 'DELETE',
          body: JSON.stringify({ ids: params.ids }),
        },
        resource
      )

      return { data: response.data }
    },
  }
}
