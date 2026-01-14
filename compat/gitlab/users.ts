/**
 * @dotdo/gitlab - Users API
 *
 * Implements GitLab Users API endpoints.
 * @see https://docs.gitlab.com/ee/api/users.html
 */

import type { GitLab, GitLabResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: number
  username: string
  name: string
  state: 'active' | 'blocked' | 'deactivated'
  avatar_url?: string | null
  web_url: string
  created_at?: string
  bio?: string | null
  location?: string | null
  public_email?: string | null
  skype?: string
  linkedin?: string
  twitter?: string
  website_url?: string
  organization?: string | null
  job_title?: string
  pronouns?: string | null
  bot?: boolean
  work_information?: string | null
  followers?: number
  following?: number
  local_time?: string | null
  is_followed?: boolean
}

export interface CurrentUser extends User {
  email: string
  theme_id?: number
  color_scheme_id?: number
  projects_limit?: number
  current_sign_in_at?: string | null
  identities?: Array<{
    provider: string
    extern_uid: string
  }>
  can_create_group?: boolean
  can_create_project?: boolean
  two_factor_enabled?: boolean
  external?: boolean
  private_profile?: boolean
  commit_email?: string
  shared_runners_minutes_limit?: number | null
  extra_shared_runners_minutes_limit?: number | null
}

export interface UserActivity {
  username: string
  last_activity_on: string
  last_activity_at: string
}

export interface SSHKey {
  id: number
  title: string
  key: string
  created_at: string
  expires_at?: string | null
  usage_type?: 'auth' | 'signing' | 'auth_and_signing'
}

export interface Email {
  id: number
  email: string
  confirmed_at?: string | null
}

export interface ListUsersParams {
  username?: string
  search?: string
  active?: boolean
  blocked?: boolean
  external?: boolean
  without_project_bots?: boolean
  order_by?: 'id' | 'name' | 'username' | 'created_at' | 'updated_at'
  sort?: 'asc' | 'desc'
  two_factor?: 'enabled' | 'disabled'
  without_projects?: boolean
  admins?: boolean
  per_page?: number
  page?: number
}

export interface GetUserParams {
  user_id: number
}

// ============================================================================
// Users API
// ============================================================================

export class UsersAPI {
  constructor(private gitlab: GitLab) {}

  /**
   * Get the current user
   * @see https://docs.gitlab.com/ee/api/users.html#for-normal-users
   */
  async getCurrentUser(): Promise<GitLabResponse<CurrentUser>> {
    return this.gitlab.request<CurrentUser>('/user')
  }

  /**
   * Get user status
   * @see https://docs.gitlab.com/ee/api/users.html#get-the-status-of-a-user
   */
  async getCurrentUserStatus(): Promise<GitLabResponse<{
    emoji: string
    message: string
    message_html: string
    availability: 'not_set' | 'busy'
    clear_status_at?: string | null
  }>> {
    return this.gitlab.request('/user/status')
  }

  /**
   * Set user status
   * @see https://docs.gitlab.com/ee/api/users.html#set-user-status
   */
  async setCurrentUserStatus(params: {
    emoji?: string
    message?: string
    availability?: 'not_set' | 'busy'
    clear_status_after?: 'thirty_minutes' | 'one_hour' | 'today' | 'this_week' | 'this_month'
  }): Promise<GitLabResponse<{
    emoji: string
    message: string
    availability: string
  }>> {
    return this.gitlab.request('/user/status', {
      method: 'PUT',
      body: params,
    })
  }

  /**
   * List users
   * @see https://docs.gitlab.com/ee/api/users.html#list-users
   */
  async list(params: ListUsersParams = {}): Promise<GitLabResponse<User[]>> {
    const query = buildQueryString(params)
    return this.gitlab.request<User[]>(`/users${query}`)
  }

  /**
   * Get a single user
   * @see https://docs.gitlab.com/ee/api/users.html#single-user
   */
  async get(params: GetUserParams): Promise<GitLabResponse<User>> {
    const { user_id } = params
    return this.gitlab.request<User>(`/users/${user_id}`)
  }

  /**
   * Get user by username
   * @see https://docs.gitlab.com/ee/api/users.html#list-users
   */
  async getByUsername(params: { username: string }): Promise<GitLabResponse<User[]>> {
    return this.gitlab.request<User[]>(`/users?username=${encodeURIComponent(params.username)}`)
  }

  /**
   * Get user status
   * @see https://docs.gitlab.com/ee/api/users.html#get-the-status-of-a-user
   */
  async getUserStatus(params: GetUserParams): Promise<GitLabResponse<{
    emoji: string
    message: string
    message_html: string
    availability: string
  }>> {
    const { user_id } = params
    return this.gitlab.request(`/users/${user_id}/status`)
  }

  /**
   * Get user followers
   * @see https://docs.gitlab.com/ee/api/users.html#followers-and-following
   */
  async listFollowers(params: GetUserParams & { per_page?: number; page?: number }): Promise<GitLabResponse<User[]>> {
    const { user_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.gitlab.request<User[]>(`/users/${user_id}/followers${query}`)
  }

  /**
   * Get user following
   * @see https://docs.gitlab.com/ee/api/users.html#followers-and-following
   */
  async listFollowing(params: GetUserParams & { per_page?: number; page?: number }): Promise<GitLabResponse<User[]>> {
    const { user_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.gitlab.request<User[]>(`/users/${user_id}/following${query}`)
  }

  /**
   * Follow a user
   * @see https://docs.gitlab.com/ee/api/users.html#follow-and-unfollow-users
   */
  async follow(params: GetUserParams): Promise<GitLabResponse<User>> {
    const { user_id } = params
    return this.gitlab.request<User>(`/users/${user_id}/follow`, {
      method: 'POST',
    })
  }

  /**
   * Unfollow a user
   * @see https://docs.gitlab.com/ee/api/users.html#follow-and-unfollow-users
   */
  async unfollow(params: GetUserParams): Promise<GitLabResponse<User>> {
    const { user_id } = params
    return this.gitlab.request<User>(`/users/${user_id}/unfollow`, {
      method: 'POST',
    })
  }

  // ==========================================================================
  // SSH Keys
  // ==========================================================================

  /**
   * List SSH keys for current user
   * @see https://docs.gitlab.com/ee/api/users.html#list-ssh-keys
   */
  async listSSHKeys(): Promise<GitLabResponse<SSHKey[]>> {
    return this.gitlab.request<SSHKey[]>('/user/keys')
  }

  /**
   * Get a single SSH key
   * @see https://docs.gitlab.com/ee/api/users.html#single-ssh-key
   */
  async getSSHKey(params: { key_id: number }): Promise<GitLabResponse<SSHKey>> {
    const { key_id } = params
    return this.gitlab.request<SSHKey>(`/user/keys/${key_id}`)
  }

  /**
   * Add SSH key for current user
   * @see https://docs.gitlab.com/ee/api/users.html#add-ssh-key
   */
  async addSSHKey(params: {
    title: string
    key: string
    expires_at?: string
    usage_type?: 'auth' | 'signing' | 'auth_and_signing'
  }): Promise<GitLabResponse<SSHKey>> {
    return this.gitlab.request<SSHKey>('/user/keys', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Delete SSH key for current user
   * @see https://docs.gitlab.com/ee/api/users.html#delete-ssh-key-for-current-user
   */
  async deleteSSHKey(params: { key_id: number }): Promise<GitLabResponse<void>> {
    const { key_id } = params
    return this.gitlab.request<void>(`/user/keys/${key_id}`, {
      method: 'DELETE',
    })
  }

  /**
   * List SSH keys for a user
   * @see https://docs.gitlab.com/ee/api/users.html#list-ssh-keys-for-user
   */
  async listSSHKeysForUser(params: GetUserParams): Promise<GitLabResponse<SSHKey[]>> {
    const { user_id } = params
    return this.gitlab.request<SSHKey[]>(`/users/${user_id}/keys`)
  }

  // ==========================================================================
  // Emails
  // ==========================================================================

  /**
   * List emails for current user
   * @see https://docs.gitlab.com/ee/api/users.html#list-emails
   */
  async listEmails(): Promise<GitLabResponse<Email[]>> {
    return this.gitlab.request<Email[]>('/user/emails')
  }

  /**
   * Get a single email
   * @see https://docs.gitlab.com/ee/api/users.html#single-email
   */
  async getEmail(params: { email_id: number }): Promise<GitLabResponse<Email>> {
    const { email_id } = params
    return this.gitlab.request<Email>(`/user/emails/${email_id}`)
  }

  /**
   * Add email for current user
   * @see https://docs.gitlab.com/ee/api/users.html#add-email
   */
  async addEmail(params: { email: string }): Promise<GitLabResponse<Email>> {
    return this.gitlab.request<Email>('/user/emails', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Delete email for current user
   * @see https://docs.gitlab.com/ee/api/users.html#delete-email-for-current-user
   */
  async deleteEmail(params: { email_id: number }): Promise<GitLabResponse<void>> {
    const { email_id } = params
    return this.gitlab.request<void>(`/user/emails/${email_id}`, {
      method: 'DELETE',
    })
  }

  /**
   * List emails for a user (admin only)
   * @see https://docs.gitlab.com/ee/api/users.html#list-emails-for-user
   */
  async listEmailsForUser(params: GetUserParams): Promise<GitLabResponse<Email[]>> {
    const { user_id } = params
    return this.gitlab.request<Email[]>(`/users/${user_id}/emails`)
  }

  // ==========================================================================
  // User Activities
  // ==========================================================================

  /**
   * Get user activities (admin only)
   * @see https://docs.gitlab.com/ee/api/users.html#get-user-activities
   */
  async listActivities(params?: {
    from?: string
    per_page?: number
    page?: number
  }): Promise<GitLabResponse<UserActivity[]>> {
    const query = buildQueryString(params || {})
    return this.gitlab.request<UserActivity[]>(`/user/activities${query}`)
  }

  // ==========================================================================
  // User Preferences
  // ==========================================================================

  /**
   * Get current user preferences
   * @see https://docs.gitlab.com/ee/api/users.html#user-preferences
   */
  async getPreferences(): Promise<GitLabResponse<{
    id: number
    user_id: number
    view_diffs_file_by_file: boolean
    show_whitespace_in_diffs: boolean
  }>> {
    return this.gitlab.request('/user/preferences')
  }

  /**
   * Update current user preferences
   * @see https://docs.gitlab.com/ee/api/users.html#user-preferences
   */
  async updatePreferences(params: {
    view_diffs_file_by_file?: boolean
    show_whitespace_in_diffs?: boolean
  }): Promise<GitLabResponse<{
    id: number
    user_id: number
    view_diffs_file_by_file: boolean
    show_whitespace_in_diffs: boolean
  }>> {
    return this.gitlab.request('/user/preferences', {
      method: 'PUT',
      body: params,
    })
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
