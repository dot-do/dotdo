/**
 * @dotdo/github - GitHub SDK Compat Layer Tests
 *
 * Comprehensive tests for Octokit-compatible GitHub API:
 * - Octokit client creation and configuration
 * - repos.get, repos.listForOrg, repos.createForAuthenticatedUser
 * - issues.create, issues.update, issues.list, issues.get
 * - pulls.create, pulls.merge, pulls.list, pulls.get
 * - actions.createWorkflowDispatch
 * - Webhook signature verification
 *
 * @see https://docs.github.com/en/rest
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types and classes we'll create
import {
  Octokit,
  type OctokitOptions,
  type RepoResponse,
  type IssueResponse,
  type PullRequestResponse,
  type WorkflowDispatchResponse,
  GitHubError,
  RequestError,
} from '../index'

import {
  verifyWebhookSignature,
  parseWebhookPayload,
  type WebhookPayload,
  type WebhookEventName,
} from '../webhooks'

// ============================================================================
// OCTOKIT CLIENT TESTS
// ============================================================================

describe('Octokit', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers(),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create client with auth token', () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })
      expect(octokit).toBeDefined()
    })

    it('should create client without auth (for public API)', () => {
      const octokit = new Octokit()
      expect(octokit).toBeDefined()
    })

    it('should accept custom base URL', () => {
      const octokit = new Octokit({
        auth: 'ghp_test_token',
        baseUrl: 'https://api.github.example.com',
      })
      expect(octokit).toBeDefined()
    })

    it('should accept custom user agent', () => {
      const octokit = new Octokit({
        auth: 'ghp_test_token',
        userAgent: 'my-app/1.0.0',
      })
      expect(octokit).toBeDefined()
    })

    it('should accept request timeout', () => {
      const octokit = new Octokit({
        auth: 'ghp_test_token',
        request: { timeout: 30000 },
      })
      expect(octokit).toBeDefined()
    })

    it('should expose rest API namespaces', () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })
      expect(octokit.rest.repos).toBeDefined()
      expect(octokit.rest.issues).toBeDefined()
      expect(octokit.rest.pulls).toBeDefined()
      expect(octokit.rest.actions).toBeDefined()
      expect(octokit.rest.users).toBeDefined()
    })
  })

  describe('request mechanics', () => {
    it('should include auth header in requests', async () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, name: 'test-repo' }),
        headers: new Headers(),
      })

      await octokit.rest.repos.get({ owner: 'owner', repo: 'repo' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/repos/owner/repo'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token ghp_test_token',
          }),
        })
      )
    })

    it('should include Accept header', async () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1 }),
        headers: new Headers(),
      })

      await octokit.rest.repos.get({ owner: 'owner', repo: 'repo' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/vnd.github+json',
          }),
        })
      )
    })

    it('should include User-Agent header', async () => {
      const octokit = new Octokit({
        auth: 'ghp_test_token',
        userAgent: 'my-app/1.0.0',
      })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1 }),
        headers: new Headers(),
      })

      await octokit.rest.repos.get({ owner: 'owner', repo: 'repo' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('my-app'),
          }),
        })
      )
    })

    it('should throw RequestError on 404', async () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          message: 'Not Found',
          documentation_url: 'https://docs.github.com',
        }),
        headers: new Headers(),
      })

      await expect(
        octokit.rest.repos.get({ owner: 'owner', repo: 'nonexistent' })
      ).rejects.toThrow(RequestError)
    })

    it('should throw RequestError on 401', async () => {
      const octokit = new Octokit({ auth: 'invalid_token' })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          message: 'Bad credentials',
        }),
        headers: new Headers(),
      })

      await expect(
        octokit.rest.repos.get({ owner: 'owner', repo: 'repo' })
      ).rejects.toThrow(RequestError)
    })

    it('should handle rate limiting (403 with retry-after)', async () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          message: 'API rate limit exceeded',
        }),
        headers: new Headers({
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        }),
      })

      await expect(
        octokit.rest.repos.get({ owner: 'owner', repo: 'repo' })
      ).rejects.toThrow(RequestError)
    })

    it('should handle network errors', async () => {
      const octokit = new Octokit({ auth: 'ghp_test_token' })

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      await expect(
        octokit.rest.repos.get({ owner: 'owner', repo: 'repo' })
      ).rejects.toThrow()
    })
  })
})

// ============================================================================
// REPOS API TESTS
// ============================================================================

describe('repos API', () => {
  let octokit: InstanceType<typeof Octokit>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    octokit = new Octokit({ auth: 'ghp_test_token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('repos.get', () => {
    it('should get repository by owner and name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 123456,
          node_id: 'R_abc123',
          name: 'test-repo',
          full_name: 'owner/test-repo',
          private: false,
          owner: {
            login: 'owner',
            id: 1,
            type: 'User',
          },
          description: 'A test repository',
          fork: false,
          url: 'https://api.github.com/repos/owner/test-repo',
          html_url: 'https://github.com/owner/test-repo',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
          pushed_at: '2024-06-01T00:00:00Z',
          default_branch: 'main',
          stargazers_count: 100,
          watchers_count: 100,
          forks_count: 10,
          open_issues_count: 5,
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.get({
        owner: 'owner',
        repo: 'test-repo',
      })

      expect(result.status).toBe(200)
      expect(result.data.id).toBe(123456)
      expect(result.data.name).toBe('test-repo')
      expect(result.data.full_name).toBe('owner/test-repo')
      expect(result.data.default_branch).toBe('main')
    })

    it('should throw for non-existent repository', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          message: 'Not Found',
          documentation_url: 'https://docs.github.com',
        }),
        headers: new Headers(),
      })

      await expect(
        octokit.rest.repos.get({ owner: 'owner', repo: 'nonexistent' })
      ).rejects.toThrow(RequestError)
    })
  })

  describe('repos.listForOrg', () => {
    it('should list repositories for an organization', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1, name: 'repo1', full_name: 'org/repo1' },
          { id: 2, name: 'repo2', full_name: 'org/repo2' },
          { id: 3, name: 'repo3', full_name: 'org/repo3' },
        ],
        headers: new Headers({
          'Link': '<https://api.github.com/orgs/org/repos?page=2>; rel="next"',
        }),
      })

      const result = await octokit.rest.repos.listForOrg({ org: 'org' })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(3)
      expect(result.data[0].name).toBe('repo1')
    })

    it('should support type filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.repos.listForOrg({
        org: 'org',
        type: 'public',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=public'),
        expect.any(Object)
      )
    })

    it('should support pagination', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.repos.listForOrg({
        org: 'org',
        per_page: 100,
        page: 2,
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/per_page=100.*page=2|page=2.*per_page=100/),
        expect.any(Object)
      )
    })

    it('should support sort and direction', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.repos.listForOrg({
        org: 'org',
        sort: 'updated',
        direction: 'desc',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=updated'),
        expect.any(Object)
      )
    })
  })

  describe('repos.listForAuthenticatedUser', () => {
    it('should list repos for authenticated user', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1, name: 'my-repo1' },
          { id: 2, name: 'my-repo2' },
        ],
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.listForAuthenticatedUser({})

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(2)
    })

    it('should support visibility filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.repos.listForAuthenticatedUser({
        visibility: 'private',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('visibility=private'),
        expect.any(Object)
      )
    })
  })

  describe('repos.createForAuthenticatedUser', () => {
    it('should create a repository', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 123,
          name: 'new-repo',
          full_name: 'user/new-repo',
          private: true,
          description: 'A new repository',
          default_branch: 'main',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.createForAuthenticatedUser({
        name: 'new-repo',
        description: 'A new repository',
        private: true,
      })

      expect(result.status).toBe(201)
      expect(result.data.name).toBe('new-repo')
      expect(result.data.private).toBe(true)
    })

    it('should support auto_init option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 1, name: 'new-repo' }),
        headers: new Headers(),
      })

      await octokit.rest.repos.createForAuthenticatedUser({
        name: 'new-repo',
        auto_init: true,
        gitignore_template: 'Node',
        license_template: 'mit',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.auto_init).toBe(true)
      expect(body.gitignore_template).toBe('Node')
    })
  })

  describe('repos.update', () => {
    it('should update a repository', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 123,
          name: 'updated-repo',
          description: 'Updated description',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.update({
        owner: 'owner',
        repo: 'repo',
        description: 'Updated description',
      })

      expect(result.status).toBe(200)
      expect(result.data.description).toBe('Updated description')
    })
  })

  describe('repos.delete', () => {
    it('should delete a repository', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => undefined,
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.delete({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result.status).toBe(204)
    })
  })

  describe('repos.listBranches', () => {
    it('should list repository branches', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { name: 'main', protected: true },
          { name: 'develop', protected: false },
          { name: 'feature/test', protected: false },
        ],
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.listBranches({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(3)
      expect(result.data[0].name).toBe('main')
    })

    it('should support protected filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ name: 'main', protected: true }],
        headers: new Headers(),
      })

      await octokit.rest.repos.listBranches({
        owner: 'owner',
        repo: 'repo',
        protected: true,
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('protected=true'),
        expect.any(Object)
      )
    })
  })

  describe('repos.getBranch', () => {
    it('should get a specific branch', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'main',
          protected: true,
          commit: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/commits/abc123',
          },
          protection: {
            enabled: true,
            required_status_checks: { strict: true },
          },
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.repos.getBranch({
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
      })

      expect(result.status).toBe(200)
      expect(result.data.name).toBe('main')
      expect(result.data.commit.sha).toBe('abc123')
    })
  })
})

// ============================================================================
// ISSUES API TESTS
// ============================================================================

describe('issues API', () => {
  let octokit: InstanceType<typeof Octokit>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    octokit = new Octokit({ auth: 'ghp_test_token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('issues.create', () => {
    it('should create an issue', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 42,
          title: 'Bug: Something is broken',
          body: 'Description of the bug',
          state: 'open',
          user: { login: 'user', id: 1 },
          labels: [],
          assignees: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          html_url: 'https://github.com/owner/repo/issues/42',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.create({
        owner: 'owner',
        repo: 'repo',
        title: 'Bug: Something is broken',
        body: 'Description of the bug',
      })

      expect(result.status).toBe(201)
      expect(result.data.number).toBe(42)
      expect(result.data.title).toBe('Bug: Something is broken')
      expect(result.data.state).toBe('open')
    })

    it('should create issue with labels and assignees', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 43,
          title: 'Feature request',
          labels: [{ name: 'enhancement' }, { name: 'help wanted' }],
          assignees: [{ login: 'developer' }],
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.create({
        owner: 'owner',
        repo: 'repo',
        title: 'Feature request',
        labels: ['enhancement', 'help wanted'],
        assignees: ['developer'],
      })

      expect(result.data.labels).toHaveLength(2)
      expect(result.data.assignees).toHaveLength(1)
    })

    it('should create issue with milestone', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 44,
          title: 'Issue with milestone',
          milestone: { number: 5, title: 'v1.0.0' },
        }),
        headers: new Headers(),
      })

      await octokit.rest.issues.create({
        owner: 'owner',
        repo: 'repo',
        title: 'Issue with milestone',
        milestone: 5,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.milestone).toBe(5)
    })
  })

  describe('issues.get', () => {
    it('should get an issue by number', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 42,
          title: 'Test issue',
          body: 'Issue body',
          state: 'open',
          user: { login: 'user', id: 1 },
          html_url: 'https://github.com/owner/repo/issues/42',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.get({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      })

      expect(result.status).toBe(200)
      expect(result.data.number).toBe(42)
      expect(result.data.title).toBe('Test issue')
    })

    it('should throw for non-existent issue', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
        headers: new Headers(),
      })

      await expect(
        octokit.rest.issues.get({ owner: 'owner', repo: 'repo', issue_number: 999 })
      ).rejects.toThrow(RequestError)
    })
  })

  describe('issues.update', () => {
    it('should update an issue', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 42,
          title: 'Updated title',
          body: 'Updated body',
          state: 'open',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.update({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        title: 'Updated title',
        body: 'Updated body',
      })

      expect(result.status).toBe(200)
      expect(result.data.title).toBe('Updated title')
    })

    it('should close an issue', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 42,
          state: 'closed',
          state_reason: 'completed',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.update({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        state: 'closed',
        state_reason: 'completed',
      })

      expect(result.data.state).toBe('closed')
      expect(result.data.state_reason).toBe('completed')
    })

    it('should update labels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 42,
          labels: [{ name: 'bug' }, { name: 'priority: high' }],
        }),
        headers: new Headers(),
      })

      await octokit.rest.issues.update({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['bug', 'priority: high'],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.labels).toEqual(['bug', 'priority: high'])
    })
  })

  describe('issues.list', () => {
    it('should list issues for a repository', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1, number: 1, title: 'Issue 1', state: 'open' },
          { id: 2, number: 2, title: 'Issue 2', state: 'open' },
          { id: 3, number: 3, title: 'Issue 3', state: 'closed' },
        ],
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.listForRepo({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(3)
    })

    it('should filter by state', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.issues.listForRepo({
        owner: 'owner',
        repo: 'repo',
        state: 'closed',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('state=closed'),
        expect.any(Object)
      )
    })

    it('should filter by labels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.issues.listForRepo({
        owner: 'owner',
        repo: 'repo',
        labels: 'bug,enhancement',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('labels=bug'),
        expect.any(Object)
      )
    })

    it('should filter by assignee', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.issues.listForRepo({
        owner: 'owner',
        repo: 'repo',
        assignee: 'developer',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('assignee=developer'),
        expect.any(Object)
      )
    })

    it('should support sort and direction', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.issues.listForRepo({
        owner: 'owner',
        repo: 'repo',
        sort: 'updated',
        direction: 'asc',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=updated'),
        expect.any(Object)
      )
    })

    it('should support since filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.issues.listForRepo({
        owner: 'owner',
        repo: 'repo',
        since: '2024-01-01T00:00:00Z',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('since='),
        expect.any(Object)
      )
    })
  })

  describe('issues.createComment', () => {
    it('should create a comment on an issue', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          body: 'This is a comment',
          user: { login: 'user', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
          html_url: 'https://github.com/owner/repo/issues/42#issuecomment-1',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.createComment({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'This is a comment',
      })

      expect(result.status).toBe(201)
      expect(result.data.body).toBe('This is a comment')
    })
  })

  describe('issues.listComments', () => {
    it('should list comments on an issue', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1, body: 'Comment 1', user: { login: 'user1' } },
          { id: 2, body: 'Comment 2', user: { login: 'user2' } },
        ],
        headers: new Headers(),
      })

      const result = await octokit.rest.issues.listComments({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(2)
    })
  })
})

// ============================================================================
// PULLS API TESTS
// ============================================================================

describe('pulls API', () => {
  let octokit: InstanceType<typeof Octokit>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    octokit = new Octokit({ auth: 'ghp_test_token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('pulls.create', () => {
    it('should create a pull request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 123,
          title: 'Add new feature',
          body: 'Description of the feature',
          state: 'open',
          head: { ref: 'feature-branch', sha: 'abc123' },
          base: { ref: 'main', sha: 'def456' },
          user: { login: 'developer', id: 1 },
          html_url: 'https://github.com/owner/repo/pull/123',
          created_at: '2024-01-01T00:00:00Z',
          merged: false,
          mergeable: true,
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.create({
        owner: 'owner',
        repo: 'repo',
        title: 'Add new feature',
        body: 'Description of the feature',
        head: 'feature-branch',
        base: 'main',
      })

      expect(result.status).toBe(201)
      expect(result.data.number).toBe(123)
      expect(result.data.title).toBe('Add new feature')
      expect(result.data.head.ref).toBe('feature-branch')
      expect(result.data.base.ref).toBe('main')
    })

    it('should create draft pull request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 124,
          title: 'WIP: New feature',
          draft: true,
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.create({
        owner: 'owner',
        repo: 'repo',
        title: 'WIP: New feature',
        head: 'wip-branch',
        base: 'main',
        draft: true,
      })

      expect(result.data.draft).toBe(true)
    })

    it('should support maintainer_can_modify option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 1, number: 125 }),
        headers: new Headers(),
      })

      await octokit.rest.pulls.create({
        owner: 'owner',
        repo: 'repo',
        title: 'PR with maintainer access',
        head: 'branch',
        base: 'main',
        maintainer_can_modify: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.maintainer_can_modify).toBe(true)
    })
  })

  describe('pulls.get', () => {
    it('should get a pull request by number', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 123,
          title: 'Test PR',
          state: 'open',
          merged: false,
          mergeable: true,
          mergeable_state: 'clean',
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main', sha: 'def456' },
          additions: 100,
          deletions: 50,
          changed_files: 5,
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.get({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
      })

      expect(result.status).toBe(200)
      expect(result.data.number).toBe(123)
      expect(result.data.additions).toBe(100)
      expect(result.data.deletions).toBe(50)
    })
  })

  describe('pulls.update', () => {
    it('should update a pull request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 123,
          title: 'Updated PR title',
          body: 'Updated description',
          state: 'open',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.update({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        title: 'Updated PR title',
        body: 'Updated description',
      })

      expect(result.data.title).toBe('Updated PR title')
    })

    it('should close a pull request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          number: 123,
          state: 'closed',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.update({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        state: 'closed',
      })

      expect(result.data.state).toBe('closed')
    })
  })

  describe('pulls.merge', () => {
    it('should merge a pull request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'merged_sha_123',
          merged: true,
          message: 'Pull Request successfully merged',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.merge({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
      })

      expect(result.status).toBe(200)
      expect(result.data.merged).toBe(true)
      expect(result.data.sha).toBe('merged_sha_123')
    })

    it('should merge with custom commit message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sha: 'abc', merged: true }),
        headers: new Headers(),
      })

      await octokit.rest.pulls.merge({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        commit_title: 'Merge: Feature X',
        commit_message: 'This adds feature X with improvements',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.commit_title).toBe('Merge: Feature X')
      expect(body.commit_message).toBe('This adds feature X with improvements')
    })

    it('should support merge method option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sha: 'abc', merged: true }),
        headers: new Headers(),
      })

      await octokit.rest.pulls.merge({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        merge_method: 'squash',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.merge_method).toBe('squash')
    })

    it('should throw when PR is not mergeable', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 405,
        json: async () => ({
          message: 'Pull Request is not mergeable',
        }),
        headers: new Headers(),
      })

      await expect(
        octokit.rest.pulls.merge({ owner: 'owner', repo: 'repo', pull_number: 123 })
      ).rejects.toThrow(RequestError)
    })
  })

  describe('pulls.list', () => {
    it('should list pull requests', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1, number: 1, title: 'PR 1', state: 'open' },
          { id: 2, number: 2, title: 'PR 2', state: 'open' },
          { id: 3, number: 3, title: 'PR 3', state: 'merged' },
        ],
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.list({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(3)
    })

    it('should filter by state', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.pulls.list({
        owner: 'owner',
        repo: 'repo',
        state: 'closed',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('state=closed'),
        expect.any(Object)
      )
    })

    it('should filter by head and base', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      })

      await octokit.rest.pulls.list({
        owner: 'owner',
        repo: 'repo',
        head: 'user:feature',
        base: 'main',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('head='),
        expect.any(Object)
      )
    })
  })

  describe('pulls.listFiles', () => {
    it('should list files in a pull request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            sha: 'abc123',
            filename: 'src/index.ts',
            status: 'modified',
            additions: 10,
            deletions: 5,
            changes: 15,
            patch: '@@ -1,5 +1,10 @@...',
          },
          {
            sha: 'def456',
            filename: 'src/utils.ts',
            status: 'added',
            additions: 50,
            deletions: 0,
            changes: 50,
          },
        ],
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.listFiles({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
      })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(2)
      expect(result.data[0].filename).toBe('src/index.ts')
      expect(result.data[0].status).toBe('modified')
    })
  })

  describe('pulls.requestReviewers', () => {
    it('should request reviewers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 123,
          requested_reviewers: [{ login: 'reviewer1' }, { login: 'reviewer2' }],
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.pulls.requestReviewers({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        reviewers: ['reviewer1', 'reviewer2'],
      })

      expect(result.status).toBe(201)
      expect(result.data.requested_reviewers).toHaveLength(2)
    })

    it('should request team reviewers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 1,
          number: 123,
          requested_teams: [{ slug: 'core-team' }],
        }),
        headers: new Headers(),
      })

      await octokit.rest.pulls.requestReviewers({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        team_reviewers: ['core-team'],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.team_reviewers).toEqual(['core-team'])
    })
  })
})

// ============================================================================
// ACTIONS API TESTS
// ============================================================================

describe('actions API', () => {
  let octokit: InstanceType<typeof Octokit>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    octokit = new Octokit({ auth: 'ghp_test_token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('actions.createWorkflowDispatch', () => {
    it('should trigger a workflow dispatch', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => undefined,
        headers: new Headers(),
      })

      const result = await octokit.rest.actions.createWorkflowDispatch({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 'deploy.yml',
        ref: 'main',
      })

      expect(result.status).toBe(204)
    })

    it('should pass inputs to workflow', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => undefined,
        headers: new Headers(),
      })

      await octokit.rest.actions.createWorkflowDispatch({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 'deploy.yml',
        ref: 'main',
        inputs: {
          environment: 'production',
          version: '1.2.3',
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.inputs.environment).toBe('production')
      expect(body.inputs.version).toBe('1.2.3')
    })

    it('should work with workflow ID number', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => undefined,
        headers: new Headers(),
      })

      await octokit.rest.actions.createWorkflowDispatch({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 12345,
        ref: 'main',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/workflows/12345/dispatches'),
        expect.any(Object)
      )
    })
  })

  describe('actions.listWorkflowRuns', () => {
    it('should list workflow runs', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 2,
          workflow_runs: [
            {
              id: 1,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              head_branch: 'main',
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              name: 'CI',
              status: 'completed',
              conclusion: 'failure',
              head_branch: 'feature',
              created_at: '2024-01-02T00:00:00Z',
            },
          ],
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.actions.listWorkflowRuns({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 'ci.yml',
      })

      expect(result.status).toBe(200)
      expect(result.data.total_count).toBe(2)
      expect(result.data.workflow_runs).toHaveLength(2)
    })

    it('should filter by status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, workflow_runs: [] }),
        headers: new Headers(),
      })

      await octokit.rest.actions.listWorkflowRuns({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 'ci.yml',
        status: 'in_progress',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=in_progress'),
        expect.any(Object)
      )
    })

    it('should filter by branch', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, workflow_runs: [] }),
        headers: new Headers(),
      })

      await octokit.rest.actions.listWorkflowRuns({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 'ci.yml',
        branch: 'main',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('branch=main'),
        expect.any(Object)
      )
    })
  })

  describe('actions.getWorkflowRun', () => {
    it('should get a specific workflow run', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 12345,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'main',
          head_sha: 'abc123',
          run_number: 42,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:10:00Z',
          html_url: 'https://github.com/owner/repo/actions/runs/12345',
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.actions.getWorkflowRun({
        owner: 'owner',
        repo: 'repo',
        run_id: 12345,
      })

      expect(result.status).toBe(200)
      expect(result.data.id).toBe(12345)
      expect(result.data.conclusion).toBe('success')
    })
  })

  describe('actions.cancelWorkflowRun', () => {
    it('should cancel a workflow run', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => undefined,
        headers: new Headers(),
      })

      const result = await octokit.rest.actions.cancelWorkflowRun({
        owner: 'owner',
        repo: 'repo',
        run_id: 12345,
      })

      expect(result.status).toBe(202)
    })
  })

  describe('actions.reRunWorkflow', () => {
    it('should re-run a workflow', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => undefined,
        headers: new Headers(),
      })

      const result = await octokit.rest.actions.reRunWorkflow({
        owner: 'owner',
        repo: 'repo',
        run_id: 12345,
      })

      expect(result.status).toBe(201)
    })
  })
})

// ============================================================================
// USERS API TESTS
// ============================================================================

describe('users API', () => {
  let octokit: InstanceType<typeof Octokit>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    octokit = new Octokit({ auth: 'ghp_test_token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('users.getAuthenticated', () => {
    it('should get authenticated user', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          login: 'octocat',
          id: 1,
          node_id: 'MDQ6VXNlcjE=',
          avatar_url: 'https://github.com/images/error/octocat_happy.gif',
          name: 'monalisa octocat',
          email: 'octocat@github.com',
          bio: 'There once was...',
          public_repos: 2,
          followers: 20,
          following: 0,
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.users.getAuthenticated()

      expect(result.status).toBe(200)
      expect(result.data.login).toBe('octocat')
      expect(result.data.email).toBe('octocat@github.com')
    })
  })

  describe('users.getByUsername', () => {
    it('should get user by username', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          login: 'octocat',
          id: 1,
          type: 'User',
          name: 'The Octocat',
          company: 'GitHub',
          blog: 'https://github.blog',
          location: 'San Francisco',
          public_repos: 8,
        }),
        headers: new Headers(),
      })

      const result = await octokit.rest.users.getByUsername({
        username: 'octocat',
      })

      expect(result.status).toBe(200)
      expect(result.data.login).toBe('octocat')
    })
  })
})

// ============================================================================
// WEBHOOK TESTS
// ============================================================================

describe('Webhooks', () => {
  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', async () => {
      const secret = 'webhook_secret'
      const payload = JSON.stringify({ action: 'opened' })

      // Generate a valid signature
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
      const hashArray = Array.from(new Uint8Array(signature))
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      const signatureHeader = `sha256=${hashHex}`

      const isValid = await verifyWebhookSignature(payload, signatureHeader, secret)

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const secret = 'webhook_secret'
      const payload = JSON.stringify({ action: 'opened' })
      const invalidSignature = 'sha256=invalid_signature_hash'

      const isValid = await verifyWebhookSignature(payload, invalidSignature, secret)

      expect(isValid).toBe(false)
    })

    it('should reject signature without sha256 prefix', async () => {
      const secret = 'webhook_secret'
      const payload = JSON.stringify({ action: 'opened' })
      const invalidSignature = 'invalid_format'

      const isValid = await verifyWebhookSignature(payload, invalidSignature, secret)

      expect(isValid).toBe(false)
    })

    it('should handle empty secret gracefully', async () => {
      const payload = JSON.stringify({ action: 'opened' })
      const signature = 'sha256=abc123'

      const isValid = await verifyWebhookSignature(payload, signature, '')

      expect(isValid).toBe(false)
    })
  })

  describe('parseWebhookPayload', () => {
    it('should parse push event', () => {
      const payload = {
        ref: 'refs/heads/main',
        before: 'abc123',
        after: 'def456',
        repository: { id: 1, name: 'repo', full_name: 'owner/repo' },
        pusher: { name: 'user', email: 'user@example.com' },
        commits: [{ id: 'def456', message: 'Update file' }],
      }

      const result = parseWebhookPayload('push', payload)

      expect(result.event).toBe('push')
      expect(result.ref).toBe('refs/heads/main')
      expect(result.repository.name).toBe('repo')
    })

    it('should parse pull_request event', () => {
      const payload = {
        action: 'opened',
        number: 123,
        pull_request: {
          id: 1,
          number: 123,
          title: 'New PR',
          state: 'open',
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main', sha: 'def456' },
          user: { login: 'developer' },
        },
        repository: { id: 1, name: 'repo' },
        sender: { login: 'developer', id: 1 },
      }

      const result = parseWebhookPayload('pull_request', payload)

      expect(result.event).toBe('pull_request')
      expect(result.action).toBe('opened')
      expect(result.pull_request.number).toBe(123)
    })

    it('should parse issues event', () => {
      const payload = {
        action: 'opened',
        issue: {
          id: 1,
          number: 42,
          title: 'Bug report',
          state: 'open',
          user: { login: 'reporter' },
        },
        repository: { id: 1, name: 'repo' },
        sender: { login: 'reporter', id: 2 },
      }

      const result = parseWebhookPayload('issues', payload)

      expect(result.event).toBe('issues')
      expect(result.action).toBe('opened')
      expect(result.issue.number).toBe(42)
    })

    it('should parse issue_comment event', () => {
      const payload = {
        action: 'created',
        issue: { id: 1, number: 42 },
        comment: { id: 100, body: 'This is a comment', user: { login: 'commenter' } },
        repository: { id: 1, name: 'repo' },
        sender: { login: 'commenter', id: 3 },
      }

      const result = parseWebhookPayload('issue_comment', payload)

      expect(result.event).toBe('issue_comment')
      expect(result.comment.body).toBe('This is a comment')
    })

    it('should parse workflow_run event', () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          id: 12345,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'main',
        },
        workflow: { id: 1, name: 'CI' },
        repository: { id: 1, name: 'repo' },
        sender: { login: 'user', id: 1 },
      }

      const result = parseWebhookPayload('workflow_run', payload)

      expect(result.event).toBe('workflow_run')
      expect(result.workflow_run.conclusion).toBe('success')
    })

    it('should parse release event', () => {
      const payload = {
        action: 'published',
        release: {
          id: 1,
          tag_name: 'v1.0.0',
          name: 'Release 1.0.0',
          body: 'Release notes',
          draft: false,
          prerelease: false,
          published_at: '2024-01-01T00:00:00Z',
        },
        repository: { id: 1, name: 'repo' },
        sender: { login: 'releaser', id: 4 },
      }

      const result = parseWebhookPayload('release', payload)

      expect(result.event).toBe('release')
      expect(result.release.tag_name).toBe('v1.0.0')
    })
  })
})

// ============================================================================
// ERROR CLASSES TESTS
// ============================================================================

describe('Error Classes', () => {
  describe('GitHubError', () => {
    it('should create error with message', () => {
      const error = new GitHubError('Something went wrong')
      expect(error.message).toBe('Something went wrong')
      expect(error.name).toBe('GitHubError')
    })
  })

  describe('RequestError', () => {
    it('should create request error with status', () => {
      const error = new RequestError('Not Found', 404, {
        message: 'Not Found',
        documentation_url: 'https://docs.github.com',
      })
      expect(error.status).toBe(404)
      expect(error.message).toBe('Not Found')
    })

    it('should include response data', () => {
      const responseData = {
        message: 'Validation Failed',
        errors: [{ resource: 'Issue', field: 'title', code: 'missing' }],
      }
      const error = new RequestError('Validation Failed', 422, responseData)
      expect(error.response).toEqual(responseData)
    })

    it('should have isRequestError property', () => {
      const error = new RequestError('Error', 500, {})
      expect(error.name).toBe('RequestError')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should work with typical PR creation workflow', async () => {
    // Simulate: create branch, create PR, request reviewers
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      switch (callCount) {
        case 1: // Create PR
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              number: 100,
              title: 'Add feature X',
              state: 'open',
              html_url: 'https://github.com/owner/repo/pull/100',
            }),
            headers: new Headers(),
          })
        case 2: // Request reviewers
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              number: 100,
              requested_reviewers: [{ login: 'reviewer1' }],
            }),
            headers: new Headers(),
          })
        default:
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({}),
            headers: new Headers(),
          })
      }
    })

    const octokit = new Octokit({ auth: 'ghp_test_token' })

    // Create PR
    const pr = await octokit.rest.pulls.create({
      owner: 'owner',
      repo: 'repo',
      title: 'Add feature X',
      head: 'feature-x',
      base: 'main',
    })
    expect(pr.data.number).toBe(100)

    // Request reviewers
    const reviewers = await octokit.rest.pulls.requestReviewers({
      owner: 'owner',
      repo: 'repo',
      pull_number: 100,
      reviewers: ['reviewer1'],
    })
    expect(reviewers.data.requested_reviewers).toHaveLength(1)
  })

  it('should work with typical issue management workflow', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      switch (callCount) {
        case 1: // Create issue
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              number: 42,
              title: 'Bug report',
              state: 'open',
            }),
            headers: new Headers(),
          })
        case 2: // Add comment
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              body: 'Working on this',
            }),
            headers: new Headers(),
          })
        case 3: // Close issue
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 1,
              number: 42,
              state: 'closed',
              state_reason: 'completed',
            }),
            headers: new Headers(),
          })
        default:
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({}),
            headers: new Headers(),
          })
      }
    })

    const octokit = new Octokit({ auth: 'ghp_test_token' })

    // Create issue
    const issue = await octokit.rest.issues.create({
      owner: 'owner',
      repo: 'repo',
      title: 'Bug report',
      body: 'Something is broken',
    })
    expect(issue.data.number).toBe(42)

    // Add comment
    await octokit.rest.issues.createComment({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      body: 'Working on this',
    })

    // Close issue
    const closed = await octokit.rest.issues.update({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      state: 'closed',
      state_reason: 'completed',
    })
    expect(closed.data.state).toBe('closed')
  })

  it('should work with workflow dispatch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
      headers: new Headers(),
    })

    const octokit = new Octokit({ auth: 'ghp_test_token' })

    const result = await octokit.rest.actions.createWorkflowDispatch({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'deploy.yml',
      ref: 'main',
      inputs: {
        environment: 'production',
        dry_run: 'false',
      },
    })

    expect(result.status).toBe(204)
  })
})
