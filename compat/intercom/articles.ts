/**
 * @dotdo/intercom - Articles Resource
 *
 * Manages Intercom help center articles with support for:
 * - Create, update, delete articles
 * - List and search articles
 * - Translated content
 *
 * @module @dotdo/intercom/articles
 */

import type {
  RequestOptions,
  Article,
  ArticleCreateParams,
  ArticleUpdateParams,
  ArticleListParams,
  ArticleSearchParams,
  ArticleSearchResponse,
  DeletedArticle,
  ListResponse,
} from './types'

import type { IntercomClientInterface } from './contacts'

/**
 * Articles resource for managing help center articles
 *
 * @example
 * ```typescript
 * // Create an article
 * const article = await client.articles.create({
 *   title: 'Getting Started',
 *   author_id: 'admin_123',
 *   body: '<p>Welcome to our getting started guide...</p>',
 *   state: 'published',
 * })
 *
 * // Search articles
 * const results = await client.articles.search({
 *   phrase: 'getting started',
 * })
 *
 * // Update an article
 * await client.articles.update(article.id, {
 *   title: 'Updated Getting Started Guide',
 * })
 * ```
 */
export class ArticlesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create an article
   *
   * @param params - Article creation parameters
   * @param options - Request options
   * @returns The created article
   */
  async create(params: ArticleCreateParams, options?: RequestOptions): Promise<Article> {
    return this.client._request('POST', '/articles', params as Record<string, unknown>, options)
  }

  /**
   * Find an article by ID
   *
   * @param id - Article ID
   * @param options - Request options
   * @returns The article
   */
  async find(id: string, options?: RequestOptions): Promise<Article> {
    return this.client._request('GET', `/articles/${id}`, undefined, options)
  }

  /**
   * Update an article
   *
   * @param id - Article ID
   * @param params - Article update parameters
   * @param options - Request options
   * @returns The updated article
   */
  async update(id: string, params: ArticleUpdateParams, options?: RequestOptions): Promise<Article> {
    return this.client._request('PUT', `/articles/${id}`, params as Record<string, unknown>, options)
  }

  /**
   * Delete an article
   *
   * @param id - Article ID
   * @param options - Request options
   * @returns Deletion confirmation
   */
  async delete(id: string, options?: RequestOptions): Promise<DeletedArticle> {
    return this.client._request('DELETE', `/articles/${id}`, undefined, options)
  }

  /**
   * List articles
   *
   * @param params - Pagination parameters
   * @param options - Request options
   * @returns Paginated list of articles
   */
  async list(params?: ArticleListParams, options?: RequestOptions): Promise<ListResponse<Article>> {
    return this.client._request('GET', '/articles', params as Record<string, unknown>, options)
  }

  /**
   * Search articles
   *
   * Search for articles by phrase with optional filters.
   *
   * @example
   * ```typescript
   * // Basic search
   * await client.articles.search({
   *   phrase: 'getting started',
   * })
   *
   * // Search in specific help center
   * await client.articles.search({
   *   phrase: 'guide',
   *   help_center_id: 'hc_123',
   *   state: 'published',
   * })
   * ```
   *
   * @param params - Search parameters
   * @param options - Request options
   * @returns Search results
   */
  async search(params: ArticleSearchParams, options?: RequestOptions): Promise<ArticleSearchResponse> {
    return this.client._request('GET', '/articles/search', params as Record<string, unknown>, options)
  }
}
