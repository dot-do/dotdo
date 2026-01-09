import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

/**
 * Admin Dashboard (Cockpit) Tests
 *
 * These tests verify the /admin/* routes for the dotdo admin dashboard.
 * They are expected to FAIL until the admin dashboard is implemented.
 *
 * The admin dashboard uses @mdxui/cockpit which provides:
 * - Shell: Sidebar + header layout
 * - DashboardView: Dashboard with metrics
 * - APIKeys: API key management
 * - Team: Team management
 * - LoginPage, SignupPage from @mdxui/cockpit/auth
 *
 * Implementation requirements:
 * - Create TanStack Start routes at app/routes/admin/*
 * - Integrate better-auth for authentication
 * - Build management views for DOs, workflows, integrations
 */

// ============================================================================
// Mock Helpers - Will be replaced with actual implementation
// ============================================================================

// Mock page fetcher - will need actual implementation
async function fetchAdminPage(path: string): Promise<Response> {
  // TODO: Replace with actual page rendering/fetching
  const { renderPage } = await import('../src/admin/render')
  return renderPage(path)
}

// Mock session/auth helper
async function createAuthenticatedSession(): Promise<{ token: string; userId: string }> {
  const { createSession } = await import('../src/admin/auth')
  return createSession()
}

// Mock unauthenticated request
async function fetchUnauthenticated(path: string): Promise<Response> {
  const { fetchPage } = await import('../src/admin/render')
  return fetchPage(path, { authenticated: false })
}

// Helper to extract content from HTML
function extractContent(html: string, selector: string): string | null {
  // Simple extraction for common patterns
  const patterns: Record<string, RegExp> = {
    'title': /<title>([^<]*)<\/title>/i,
    'h1': /<h1[^>]*>([^<]*)<\/h1>/i,
    'sidebar': /<nav[^>]*class="[^"]*sidebar[^"]*"[^>]*>([\s\S]*?)<\/nav>/i,
    'main': /<main[^>]*>([\s\S]*?)<\/main>/i,
    'header': /<header[^>]*>([\s\S]*?)<\/header>/i,
  }
  const regex = patterns[selector]
  if (!regex) return null
  const match = html.match(regex)
  return match?.[1] ?? null
}

// Helper to check if element exists in HTML
function hasElement(html: string, selector: string): boolean {
  const patterns: Record<string, RegExp> = {
    'sidebar': /<nav[^>]*sidebar/i,
    'header': /<header/i,
    'main': /<main/i,
    'table': /<table/i,
    'form': /<form/i,
    'button': /<button/i,
    'input': /<input/i,
  }
  const regex = patterns[selector] ?? new RegExp(`<${selector}`, 'i')
  return regex.test(html)
}

// ============================================================================
// Route Files - Structure Tests
// ============================================================================

describe('Admin Dashboard Routes Structure', () => {
  describe('app/routes/admin/index.tsx', () => {
    it('should exist as main admin route', () => {
      expect(existsSync('app/routes/admin/index.tsx')).toBe(true)
    })

    it('should use Shell from @mdxui/cockpit', async () => {
      const content = await readFile('app/routes/admin/index.tsx', 'utf-8')
      expect(content).toContain('@mdxui/cockpit')
      expect(content).toContain('Shell')
    })

    it('should use DashboardView for metrics display', async () => {
      const content = await readFile('app/routes/admin/index.tsx', 'utf-8')
      expect(content).toContain('DashboardView')
    })
  })

  describe('app/routes/admin/login.tsx', () => {
    it('should exist for authentication', () => {
      expect(existsSync('app/routes/admin/login.tsx')).toBe(true)
    })

    it('should use LoginPage from @mdxui/cockpit/auth', async () => {
      const content = await readFile('app/routes/admin/login.tsx', 'utf-8')
      expect(content).toContain('@mdxui/cockpit/auth')
      expect(content).toContain('LoginPage')
    })
  })

  describe('app/routes/admin/users/', () => {
    it('should have users index route', () => {
      expect(existsSync('app/routes/admin/users/index.tsx')).toBe(true)
    })

    it('should have user detail route', () => {
      expect(existsSync('app/routes/admin/users/$userId.tsx')).toBe(true)
    })
  })

  describe('app/routes/admin/integrations/', () => {
    it('should have integrations index route', () => {
      expect(existsSync('app/routes/admin/integrations/index.tsx')).toBe(true)
    })

    it('should have integration detail route', () => {
      expect(existsSync('app/routes/admin/integrations/$integrationId.tsx')).toBe(true)
    })
  })

  describe('app/routes/admin/workflows/', () => {
    it('should have workflows index route', () => {
      expect(existsSync('app/routes/admin/workflows/index.tsx')).toBe(true)
    })

    it('should have workflow detail route', () => {
      expect(existsSync('app/routes/admin/workflows/$workflowId.tsx')).toBe(true)
    })

    it('should have workflow runs route', () => {
      expect(existsSync('app/routes/admin/workflows/$workflowId/runs.tsx')).toBe(true)
    })
  })

  describe('app/routes/admin/activity/', () => {
    it('should have activity logs route', () => {
      expect(existsSync('app/routes/admin/activity/index.tsx')).toBe(true)
    })
  })

  describe('app/routes/admin/settings/', () => {
    it('should have settings index route', () => {
      expect(existsSync('app/routes/admin/settings/index.tsx')).toBe(true)
    })
  })
})

// ============================================================================
// Authentication Tests
// ============================================================================

describe('Admin Authentication', () => {
  describe('Unauthenticated access', () => {
    it('should redirect /admin to /admin/login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/users to /admin/login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/users')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/integrations to /admin/login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/integrations')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/workflows to /admin/login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/workflows')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/activity to /admin/login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/activity')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/settings to /admin/login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/settings')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should allow access to /admin/login without authentication', async () => {
      const res = await fetchUnauthenticated('/admin/login')

      expect(res.status).toBe(200)
    })
  })

  describe('Session management', () => {
    it('should create valid session on successful login', async () => {
      const session = await createAuthenticatedSession()

      expect(session.token).toBeDefined()
      expect(session.token.length).toBeGreaterThan(0)
      expect(session.userId).toBeDefined()
    })

    it('should include session cookie in authenticated response', async () => {
      const res = await fetchAdminPage('/admin')

      expect(res.headers.get('set-cookie')).toBeDefined()
    })
  })
})

// ============================================================================
// Layout Tests - Shell, Sidebar, Header
// ============================================================================

describe('Admin Layout', () => {
  let dashboardHtml: string

  beforeAll(async () => {
    const res = await fetchAdminPage('/admin')
    dashboardHtml = await res.text()
  })

  describe('Shell component', () => {
    it('should render Shell wrapper', () => {
      expect(dashboardHtml).toContain('data-shell')
    })

    it('should have sidebar navigation', () => {
      expect(hasElement(dashboardHtml, 'sidebar')).toBe(true)
    })

    it('should have header section', () => {
      expect(hasElement(dashboardHtml, 'header')).toBe(true)
    })

    it('should have main content area', () => {
      expect(hasElement(dashboardHtml, 'main')).toBe(true)
    })
  })

  describe('Sidebar navigation', () => {
    it('should have Dashboard link', () => {
      expect(dashboardHtml).toContain('href="/admin"')
      expect(dashboardHtml).toMatch(/Dashboard/i)
    })

    it('should have Users link', () => {
      expect(dashboardHtml).toContain('href="/admin/users"')
      expect(dashboardHtml).toMatch(/Users/i)
    })

    it('should have Integrations link', () => {
      expect(dashboardHtml).toContain('href="/admin/integrations"')
      expect(dashboardHtml).toMatch(/Integrations/i)
    })

    it('should have Workflows link', () => {
      expect(dashboardHtml).toContain('href="/admin/workflows"')
      expect(dashboardHtml).toMatch(/Workflows/i)
    })

    it('should have Activity link', () => {
      expect(dashboardHtml).toContain('href="/admin/activity"')
      expect(dashboardHtml).toMatch(/Activity/i)
    })

    it('should have Settings link', () => {
      expect(dashboardHtml).toContain('href="/admin/settings"')
      expect(dashboardHtml).toMatch(/Settings/i)
    })
  })

  describe('Header section', () => {
    it('should display user profile', () => {
      expect(dashboardHtml).toMatch(/profile|avatar|user/i)
    })

    it('should have logout button', () => {
      expect(dashboardHtml).toMatch(/logout|sign out/i)
    })
  })
})

// ============================================================================
// Dashboard View Tests
// ============================================================================

describe('Dashboard View', () => {
  let dashboardHtml: string

  beforeAll(async () => {
    const res = await fetchAdminPage('/admin')
    dashboardHtml = await res.text()
  })

  describe('Metrics display', () => {
    it('should display Durable Objects count metric', () => {
      expect(dashboardHtml).toMatch(/Durable Objects|DOs/i)
    })

    it('should display Requests metric', () => {
      expect(dashboardHtml).toMatch(/Requests/i)
    })

    it('should display Active Workflows metric', () => {
      expect(dashboardHtml).toMatch(/Workflows|Active Workflows/i)
    })

    it('should display Users metric', () => {
      expect(dashboardHtml).toMatch(/Users/i)
    })
  })

  describe('Period selector', () => {
    it('should have time period options', () => {
      expect(dashboardHtml).toMatch(/day|week|month/i)
    })
  })

  describe('Recent activity section', () => {
    it('should display recent activity list', () => {
      expect(dashboardHtml).toMatch(/Recent Activity|Recent/i)
    })
  })
})

// ============================================================================
// User Management Tests
// ============================================================================

describe('User Management', () => {
  describe('User list page (/admin/users)', () => {
    let usersHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/users')
      usersHtml = await res.text()
    })

    it('should return 200 status', async () => {
      const res = await fetchAdminPage('/admin/users')
      expect(res.status).toBe(200)
    })

    it('should display users table', () => {
      expect(hasElement(usersHtml, 'table')).toBe(true)
    })

    it('should have column headers for name, email, role, status', () => {
      expect(usersHtml).toMatch(/Name/i)
      expect(usersHtml).toMatch(/Email/i)
      expect(usersHtml).toMatch(/Role/i)
      expect(usersHtml).toMatch(/Status/i)
    })

    it('should have create user button', () => {
      expect(usersHtml).toMatch(/Create User|Add User|New User/i)
    })

    it('should have search/filter functionality', () => {
      expect(hasElement(usersHtml, 'input')).toBe(true)
      expect(usersHtml).toMatch(/search|filter/i)
    })

    it('should have pagination controls', () => {
      expect(usersHtml).toMatch(/previous|next|page/i)
    })
  })

  describe('User detail page (/admin/users/:id)', () => {
    let userDetailHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/users/test-user-123')
      userDetailHtml = await res.text()
    })

    it('should return 200 status for valid user', async () => {
      const res = await fetchAdminPage('/admin/users/test-user-123')
      expect(res.status).toBe(200)
    })

    it('should display user details', () => {
      expect(userDetailHtml).toMatch(/Name|Email|Role/i)
    })

    it('should have edit user button', () => {
      expect(userDetailHtml).toMatch(/Edit/i)
    })

    it('should have delete user button', () => {
      expect(userDetailHtml).toMatch(/Delete/i)
    })

    it('should show user activity history', () => {
      expect(userDetailHtml).toMatch(/Activity|History/i)
    })
  })

  describe('Create user form', () => {
    let createUserHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/users/new')
      createUserHtml = await res.text()
    })

    it('should have name input field', () => {
      expect(createUserHtml).toMatch(/name="name"|id="name"/i)
    })

    it('should have email input field', () => {
      expect(createUserHtml).toMatch(/name="email"|id="email"|type="email"/i)
    })

    it('should have role selection', () => {
      expect(createUserHtml).toMatch(/role/i)
    })

    it('should have submit button', () => {
      expect(createUserHtml).toMatch(/type="submit"|Create|Save/i)
    })
  })
})

// ============================================================================
// Integration Management Tests
// ============================================================================

describe('Integration Management', () => {
  describe('Integration list page (/admin/integrations)', () => {
    let integrationsHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/integrations')
      integrationsHtml = await res.text()
    })

    it('should return 200 status', async () => {
      const res = await fetchAdminPage('/admin/integrations')
      expect(res.status).toBe(200)
    })

    it('should display available providers', () => {
      expect(integrationsHtml).toMatch(/Provider|Integration/i)
    })

    it('should show connection status for each provider', () => {
      expect(integrationsHtml).toMatch(/Connected|Disconnected|Status/i)
    })

    it('should have connect/disconnect buttons', () => {
      expect(integrationsHtml).toMatch(/Connect|Disconnect/i)
    })

    it('should display OAuth providers', () => {
      // Common OAuth providers
      expect(integrationsHtml).toMatch(/Google|GitHub|Microsoft|Slack/i)
    })
  })

  describe('Integration detail page (/admin/integrations/:id)', () => {
    let integrationDetailHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/integrations/github')
      integrationDetailHtml = await res.text()
    })

    it('should return 200 status for valid integration', async () => {
      const res = await fetchAdminPage('/admin/integrations/github')
      expect(res.status).toBe(200)
    })

    it('should display integration configuration', () => {
      expect(integrationDetailHtml).toMatch(/Configuration|Settings/i)
    })

    it('should show connection details', () => {
      expect(integrationDetailHtml).toMatch(/Client ID|Credentials|Token/i)
    })

    it('should have test connection button', () => {
      expect(integrationDetailHtml).toMatch(/Test Connection|Test/i)
    })

    it('should display sync status', () => {
      expect(integrationDetailHtml).toMatch(/Last Sync|Sync Status/i)
    })
  })

  describe('API Keys management', () => {
    let apiKeysHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/integrations/api-keys')
      apiKeysHtml = await res.text()
    })

    it('should display API keys table', () => {
      expect(hasElement(apiKeysHtml, 'table')).toBe(true)
    })

    it('should show key name, created date, last used', () => {
      expect(apiKeysHtml).toMatch(/Name|Created|Last Used/i)
    })

    it('should have create new key button', () => {
      expect(apiKeysHtml).toMatch(/Create Key|New Key|Generate/i)
    })

    it('should have revoke key option', () => {
      expect(apiKeysHtml).toMatch(/Revoke|Delete|Remove/i)
    })
  })
})

// ============================================================================
// Workflow Monitoring Tests
// ============================================================================

describe('Workflow Monitoring', () => {
  describe('Workflow list page (/admin/workflows)', () => {
    let workflowsHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/workflows')
      workflowsHtml = await res.text()
    })

    it('should return 200 status', async () => {
      const res = await fetchAdminPage('/admin/workflows')
      expect(res.status).toBe(200)
    })

    it('should display workflows table', () => {
      expect(hasElement(workflowsHtml, 'table')).toBe(true)
    })

    it('should show workflow name, status, last run', () => {
      expect(workflowsHtml).toMatch(/Name|Workflow/i)
      expect(workflowsHtml).toMatch(/Status/i)
      expect(workflowsHtml).toMatch(/Last Run|Last Executed/i)
    })

    it('should have filter by status', () => {
      expect(workflowsHtml).toMatch(/Active|Paused|Failed|Filter/i)
    })

    it('should have search functionality', () => {
      expect(workflowsHtml).toMatch(/search/i)
    })
  })

  describe('Workflow detail page (/admin/workflows/:id)', () => {
    let workflowDetailHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/workflows/test-workflow-123')
      workflowDetailHtml = await res.text()
    })

    it('should return 200 status for valid workflow', async () => {
      const res = await fetchAdminPage('/admin/workflows/test-workflow-123')
      expect(res.status).toBe(200)
    })

    it('should display workflow configuration', () => {
      expect(workflowDetailHtml).toMatch(/Configuration|Settings|Details/i)
    })

    it('should show trigger type', () => {
      expect(workflowDetailHtml).toMatch(/Trigger|Schedule|Event/i)
    })

    it('should have pause/resume button', () => {
      expect(workflowDetailHtml).toMatch(/Pause|Resume|Enable|Disable/i)
    })

    it('should have run manually button', () => {
      expect(workflowDetailHtml).toMatch(/Run Now|Execute|Trigger/i)
    })

    it('should display recent runs summary', () => {
      expect(workflowDetailHtml).toMatch(/Recent Runs|History|Executions/i)
    })
  })

  describe('Workflow runs page (/admin/workflows/:id/runs)', () => {
    let runsHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/workflows/test-workflow-123/runs')
      runsHtml = await res.text()
    })

    it('should return 200 status', async () => {
      const res = await fetchAdminPage('/admin/workflows/test-workflow-123/runs')
      expect(res.status).toBe(200)
    })

    it('should display runs table', () => {
      expect(hasElement(runsHtml, 'table')).toBe(true)
    })

    it('should show run ID, start time, duration, status', () => {
      expect(runsHtml).toMatch(/Run ID|ID/i)
      expect(runsHtml).toMatch(/Start|Started/i)
      expect(runsHtml).toMatch(/Duration/i)
      expect(runsHtml).toMatch(/Status|Result/i)
    })

    it('should have filter by status (success, failed, running)', () => {
      expect(runsHtml).toMatch(/Success|Failed|Running|Pending/i)
    })

    it('should have view logs link for each run', () => {
      expect(runsHtml).toMatch(/Logs|View|Details/i)
    })
  })

  describe('Run detail page', () => {
    let runDetailHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/workflows/test-workflow-123/runs/run-456')
      runDetailHtml = await res.text()
    })

    it('should display step-by-step execution', () => {
      expect(runDetailHtml).toMatch(/Step|Stage/i)
    })

    it('should show execution logs', () => {
      expect(runDetailHtml).toMatch(/Logs|Output/i)
    })

    it('should display input/output data', () => {
      expect(runDetailHtml).toMatch(/Input|Output|Data/i)
    })

    it('should show execution timeline', () => {
      expect(runDetailHtml).toMatch(/Timeline|Duration|Time/i)
    })
  })
})

// ============================================================================
// Activity Logs Tests
// ============================================================================

describe('Activity Logs', () => {
  describe('Activity logs page (/admin/activity)', () => {
    let activityHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/activity')
      activityHtml = await res.text()
    })

    it('should return 200 status', async () => {
      const res = await fetchAdminPage('/admin/activity')
      expect(res.status).toBe(200)
    })

    it('should display activity log table', () => {
      expect(hasElement(activityHtml, 'table')).toBe(true)
    })

    it('should show timestamp, actor, action, resource', () => {
      expect(activityHtml).toMatch(/Time|Timestamp/i)
      expect(activityHtml).toMatch(/User|Actor/i)
      expect(activityHtml).toMatch(/Action/i)
      expect(activityHtml).toMatch(/Resource|Target/i)
    })

    it('should have filter by action type', () => {
      expect(activityHtml).toMatch(/Create|Update|Delete|Login/i)
    })

    it('should have filter by user', () => {
      expect(activityHtml).toMatch(/User|Actor/i)
    })

    it('should have filter by date range', () => {
      expect(activityHtml).toMatch(/Date|From|To|Range/i)
    })

    it('should have search functionality', () => {
      expect(activityHtml).toMatch(/search/i)
    })

    it('should have pagination', () => {
      expect(activityHtml).toMatch(/Previous|Next|Page/i)
    })
  })

  describe('Activity log details', () => {
    let activityDetailHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/activity/log-123')
      activityDetailHtml = await res.text()
    })

    it('should display full log entry details', () => {
      expect(activityDetailHtml).toMatch(/Details|Information/i)
    })

    it('should show request metadata', () => {
      expect(activityDetailHtml).toMatch(/IP|User Agent|Request/i)
    })

    it('should display changed fields for update actions', () => {
      expect(activityDetailHtml).toMatch(/Changes|Modified|Before|After/i)
    })
  })
})

// ============================================================================
// Settings Tests
// ============================================================================

describe('Settings', () => {
  describe('Settings page (/admin/settings)', () => {
    let settingsHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/settings')
      settingsHtml = await res.text()
    })

    it('should return 200 status', async () => {
      const res = await fetchAdminPage('/admin/settings')
      expect(res.status).toBe(200)
    })

    it('should have account settings section', () => {
      expect(settingsHtml).toMatch(/Account|Profile/i)
    })

    it('should have security settings section', () => {
      expect(settingsHtml).toMatch(/Security|Password|Two-Factor|2FA/i)
    })

    it('should have notification preferences section', () => {
      expect(settingsHtml).toMatch(/Notification|Email|Alert/i)
    })

    it('should have appearance/theme settings', () => {
      expect(settingsHtml).toMatch(/Appearance|Theme|Dark Mode/i)
    })
  })

  describe('Account settings', () => {
    let accountHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/settings/account')
      accountHtml = await res.text()
    })

    it('should have name edit form', () => {
      expect(accountHtml).toMatch(/Name/i)
      expect(hasElement(accountHtml, 'form')).toBe(true)
    })

    it('should have email display', () => {
      expect(accountHtml).toMatch(/Email/i)
    })

    it('should have save button', () => {
      expect(accountHtml).toMatch(/Save|Update/i)
    })
  })

  describe('Security settings', () => {
    let securityHtml: string

    beforeAll(async () => {
      const res = await fetchAdminPage('/admin/settings/security')
      securityHtml = await res.text()
    })

    it('should have password change form', () => {
      expect(securityHtml).toMatch(/Password/i)
      expect(securityHtml).toMatch(/Current|New|Confirm/i)
    })

    it('should have 2FA toggle', () => {
      expect(securityHtml).toMatch(/Two-Factor|2FA|MFA/i)
    })

    it('should display active sessions', () => {
      expect(securityHtml).toMatch(/Session|Device|Active/i)
    })

    it('should have sign out all sessions button', () => {
      expect(securityHtml).toMatch(/Sign Out|Logout|Revoke/i)
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('should return 404 for non-existent admin routes', async () => {
    const res = await fetchAdminPage('/admin/nonexistent-route')
    expect(res.status).toBe(404)
  })

  it('should return 404 for non-existent user', async () => {
    const res = await fetchAdminPage('/admin/users/nonexistent-user-id')
    expect(res.status).toBe(404)
  })

  it('should return 404 for non-existent workflow', async () => {
    const res = await fetchAdminPage('/admin/workflows/nonexistent-workflow-id')
    expect(res.status).toBe(404)
  })

  it('should return 404 for non-existent integration', async () => {
    const res = await fetchAdminPage('/admin/integrations/nonexistent-integration')
    expect(res.status).toBe(404)
  })

  it('should display user-friendly error page', async () => {
    const res = await fetchAdminPage('/admin/nonexistent')
    const html = await res.text()
    expect(html).toMatch(/Not Found|404|Error/i)
  })
})

// ============================================================================
// Responsive Design Tests
// ============================================================================

describe('Responsive Design', () => {
  it('should have responsive meta viewport', async () => {
    const res = await fetchAdminPage('/admin')
    const html = await res.text()
    expect(html).toMatch(/viewport/)
    expect(html).toMatch(/width=device-width/)
  })

  it('should have responsive sidebar styles', async () => {
    const res = await fetchAdminPage('/admin')
    const html = await res.text()
    // Should have mobile menu toggle or responsive classes
    expect(html).toMatch(/mobile|hamburger|menu-toggle|lg:|md:/i)
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  let dashboardHtml: string

  beforeAll(async () => {
    const res = await fetchAdminPage('/admin')
    dashboardHtml = await res.text()
  })

  it('should have proper heading hierarchy', () => {
    expect(dashboardHtml).toMatch(/<h1/i)
  })

  it('should have alt text on images', () => {
    // If there are images, they should have alt attributes
    const imgMatches = dashboardHtml.match(/<img[^>]*>/gi) || []
    for (const img of imgMatches) {
      expect(img).toMatch(/alt=/i)
    }
  })

  it('should have aria labels on interactive elements', () => {
    expect(dashboardHtml).toMatch(/aria-label|aria-labelledby/i)
  })

  it('should have proper form labels', async () => {
    const res = await fetchAdminPage('/admin/users/new')
    const formHtml = await res.text()
    expect(formHtml).toMatch(/<label/i)
  })

  it('should have skip to content link', () => {
    expect(dashboardHtml).toMatch(/skip.*content|main-content/i)
  })

  it('should have lang attribute on html', () => {
    expect(dashboardHtml).toMatch(/<html[^>]+lang=/i)
  })
})
