/**
 * @dotdo/github - Users API
 *
 * Implements GitHub Users API endpoints.
 * @see https://docs.github.com/en/rest/users
 */

import type { Octokit, OctokitResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface User {
  login: string
  id: number
  node_id?: string
  avatar_url: string
  gravatar_id?: string | null
  url?: string
  html_url?: string
  followers_url?: string
  following_url?: string
  gists_url?: string
  starred_url?: string
  subscriptions_url?: string
  organizations_url?: string
  repos_url?: string
  events_url?: string
  received_events_url?: string
  type: 'User' | 'Organization' | 'Bot'
  site_admin?: boolean
  name?: string | null
  company?: string | null
  blog?: string | null
  location?: string | null
  email?: string | null
  hireable?: boolean | null
  bio?: string | null
  twitter_username?: string | null
  public_repos?: number
  public_gists?: number
  followers?: number
  following?: number
  created_at?: string
  updated_at?: string
  private_gists?: number
  total_private_repos?: number
  owned_private_repos?: number
  disk_usage?: number
  collaborators?: number
  two_factor_authentication?: boolean
  plan?: {
    name: string
    space: number
    private_repos: number
    collaborators: number
  }
  locale?: string
}

export interface PublicUser {
  login: string
  id: number
  node_id?: string
  avatar_url: string
  gravatar_id?: string | null
  url?: string
  html_url?: string
  type: 'User' | 'Organization'
  site_admin?: boolean
  name?: string | null
  company?: string | null
  blog?: string | null
  location?: string | null
  email?: string | null
  hireable?: boolean | null
  bio?: string | null
  twitter_username?: string | null
  public_repos?: number
  public_gists?: number
  followers?: number
  following?: number
  created_at?: string
  updated_at?: string
}

export interface SocialAccount {
  provider: string
  url: string
}

// ============================================================================
// Users API
// ============================================================================

export class UsersAPI {
  constructor(private octokit: Octokit) {}

  /**
   * Get the authenticated user
   * @see https://docs.github.com/en/rest/users/users#get-the-authenticated-user
   */
  async getAuthenticated(): Promise<OctokitResponse<User>> {
    return this.octokit.request<User>('/user')
  }

  /**
   * Get a user
   * @see https://docs.github.com/en/rest/users/users#get-a-user
   */
  async getByUsername(params: {
    username: string
  }): Promise<OctokitResponse<PublicUser>> {
    const { username } = params
    return this.octokit.request<PublicUser>(`/users/${username}`)
  }

  /**
   * Update the authenticated user
   * @see https://docs.github.com/en/rest/users/users#update-the-authenticated-user
   */
  async updateAuthenticated(params: {
    name?: string
    email?: string
    blog?: string
    twitter_username?: string | null
    company?: string
    location?: string
    hireable?: boolean
    bio?: string
  }): Promise<OctokitResponse<User>> {
    return this.octokit.request<User>('/user', {
      method: 'PATCH',
      body: params,
    })
  }

  /**
   * List users
   * @see https://docs.github.com/en/rest/users/users#list-users
   */
  async list(params?: {
    since?: number
    per_page?: number
  }): Promise<OctokitResponse<PublicUser[]>> {
    const query = buildQueryString(params || {})
    return this.octokit.request<PublicUser[]>(`/users${query}`)
  }

  // ==========================================================================
  // Followers
  // ==========================================================================

  /**
   * List followers of the authenticated user
   * @see https://docs.github.com/en/rest/users/followers#list-followers-of-the-authenticated-user
   */
  async listFollowersForAuthenticatedUser(params?: {
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<PublicUser[]>> {
    const query = buildQueryString(params || {})
    return this.octokit.request<PublicUser[]>(`/user/followers${query}`)
  }

  /**
   * List followers of a user
   * @see https://docs.github.com/en/rest/users/followers#list-followers-of-a-user
   */
  async listFollowersForUser(params: {
    username: string
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<PublicUser[]>> {
    const { username, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<PublicUser[]>(`/users/${username}/followers${query}`)
  }

  /**
   * List the people the authenticated user follows
   * @see https://docs.github.com/en/rest/users/followers#list-the-people-the-authenticated-user-follows
   */
  async listFollowingForAuthenticatedUser(params?: {
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<PublicUser[]>> {
    const query = buildQueryString(params || {})
    return this.octokit.request<PublicUser[]>(`/user/following${query}`)
  }

  /**
   * List the people a user follows
   * @see https://docs.github.com/en/rest/users/followers#list-the-people-a-user-follows
   */
  async listFollowingForUser(params: {
    username: string
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<PublicUser[]>> {
    const { username, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<PublicUser[]>(`/users/${username}/following${query}`)
  }

  /**
   * Check if a person is followed by the authenticated user
   * @see https://docs.github.com/en/rest/users/followers#check-if-a-person-is-followed-by-the-authenticated-user
   */
  async checkPersonIsFollowedByAuthenticated(params: {
    username: string
  }): Promise<OctokitResponse<void>> {
    const { username } = params
    return this.octokit.request<void>(`/user/following/${username}`)
  }

  /**
   * Follow a user
   * @see https://docs.github.com/en/rest/users/followers#follow-a-user
   */
  async follow(params: { username: string }): Promise<OctokitResponse<void>> {
    const { username } = params
    return this.octokit.request<void>(`/user/following/${username}`, {
      method: 'PUT',
    })
  }

  /**
   * Unfollow a user
   * @see https://docs.github.com/en/rest/users/followers#unfollow-a-user
   */
  async unfollow(params: { username: string }): Promise<OctokitResponse<void>> {
    const { username } = params
    return this.octokit.request<void>(`/user/following/${username}`, {
      method: 'DELETE',
    })
  }

  // ==========================================================================
  // Emails
  // ==========================================================================

  /**
   * List email addresses for the authenticated user
   * @see https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user
   */
  async listEmailsForAuthenticatedUser(params?: {
    per_page?: number
    page?: number
  }): Promise<
    OctokitResponse<
      Array<{
        email: string
        primary: boolean
        verified: boolean
        visibility: 'public' | 'private' | null
      }>
    >
  > {
    const query = buildQueryString(params || {})
    return this.octokit.request(`/user/emails${query}`)
  }

  /**
   * Add email address(es)
   * @see https://docs.github.com/en/rest/users/emails#add-an-email-address-for-the-authenticated-user
   */
  async addEmailForAuthenticatedUser(params: {
    emails: string[]
  }): Promise<
    OctokitResponse<Array<{ email: string; primary: boolean; verified: boolean }>>
  > {
    return this.octokit.request('/user/emails', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Delete email address(es)
   * @see https://docs.github.com/en/rest/users/emails#delete-an-email-address-for-the-authenticated-user
   */
  async deleteEmailForAuthenticatedUser(params: {
    emails: string[]
  }): Promise<OctokitResponse<void>> {
    return this.octokit.request<void>('/user/emails', {
      method: 'DELETE',
      body: params,
    })
  }

  // ==========================================================================
  // SSH Keys
  // ==========================================================================

  /**
   * List public SSH keys for the authenticated user
   * @see https://docs.github.com/en/rest/users/keys#list-public-ssh-keys-for-the-authenticated-user
   */
  async listPublicSshKeysForAuthenticatedUser(params?: {
    per_page?: number
    page?: number
  }): Promise<
    OctokitResponse<
      Array<{
        id: number
        key: string
        title: string
        created_at: string
      }>
    >
  > {
    const query = buildQueryString(params || {})
    return this.octokit.request(`/user/keys${query}`)
  }

  /**
   * Create a public SSH key for the authenticated user
   * @see https://docs.github.com/en/rest/users/keys#create-a-public-ssh-key-for-the-authenticated-user
   */
  async createPublicSshKeyForAuthenticatedUser(params: {
    title: string
    key: string
  }): Promise<OctokitResponse<{ id: number; key: string; title: string }>> {
    return this.octokit.request('/user/keys', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Delete a public SSH key for the authenticated user
   * @see https://docs.github.com/en/rest/users/keys#delete-a-public-ssh-key-for-the-authenticated-user
   */
  async deletePublicSshKeyForAuthenticatedUser(params: {
    key_id: number
  }): Promise<OctokitResponse<void>> {
    const { key_id } = params
    return this.octokit.request<void>(`/user/keys/${key_id}`, {
      method: 'DELETE',
    })
  }

  /**
   * List public keys for a user
   * @see https://docs.github.com/en/rest/users/keys#list-public-keys-for-a-user
   */
  async listPublicKeysForUser(params: {
    username: string
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<Array<{ id: number; key: string }>>> {
    const { username, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request(`/users/${username}/keys${query}`)
  }

  // ==========================================================================
  // Social Accounts
  // ==========================================================================

  /**
   * List social accounts for the authenticated user
   * @see https://docs.github.com/en/rest/users/social-accounts#list-social-accounts-for-the-authenticated-user
   */
  async listSocialAccountsForAuthenticatedUser(params?: {
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<SocialAccount[]>> {
    const query = buildQueryString(params || {})
    return this.octokit.request<SocialAccount[]>(`/user/social_accounts${query}`)
  }

  /**
   * Add social accounts for the authenticated user
   * @see https://docs.github.com/en/rest/users/social-accounts#add-social-accounts-for-the-authenticated-user
   */
  async addSocialAccountForAuthenticatedUser(params: {
    account_urls: string[]
  }): Promise<OctokitResponse<SocialAccount[]>> {
    return this.octokit.request<SocialAccount[]>('/user/social_accounts', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Delete social accounts for the authenticated user
   * @see https://docs.github.com/en/rest/users/social-accounts#delete-social-accounts-for-the-authenticated-user
   */
  async deleteSocialAccountForAuthenticatedUser(params: {
    account_urls: string[]
  }): Promise<OctokitResponse<void>> {
    return this.octokit.request<void>('/user/social_accounts', {
      method: 'DELETE',
      body: params,
    })
  }

  /**
   * List social accounts for a user
   * @see https://docs.github.com/en/rest/users/social-accounts#list-social-accounts-for-a-user
   */
  async listSocialAccountsForUser(params: {
    username: string
    per_page?: number
    page?: number
  }): Promise<OctokitResponse<SocialAccount[]>> {
    const { username, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<SocialAccount[]>(
      `/users/${username}/social_accounts${query}`
    )
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildQueryString(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null
  )
  if (entries.length === 0) return ''
  const searchParams = new URLSearchParams()
  for (const [key, value] of entries) {
    searchParams.set(key, String(value))
  }
  return `?${searchParams.toString()}`
}
