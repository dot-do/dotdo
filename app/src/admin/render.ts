/**
 * Admin Page Render Module
 *
 * Provides server-side rendering for admin dashboard pages.
 * Used by tests to verify page content and behavior.
 */

import { getCurrentSession } from './auth'

// Route handlers for each admin page
const routes: Record<string, (params?: Record<string, string>) => string> = {
  '/admin': renderDashboard,
  '/admin/login': renderLogin,
  '/admin/users': renderUsersList,
  '/admin/users/new': renderUserCreate,
  '/admin/integrations': renderIntegrationsList,
  '/admin/integrations/api-keys': renderAPIKeys,
  '/admin/workflows': renderWorkflowsList,
  '/admin/activity': renderActivityLogs,
  '/admin/settings': renderSettings,
  '/admin/settings/account': renderAccountSettings,
  '/admin/settings/security': renderSecuritySettings,
}

// Dynamic route patterns
const dynamicRoutes: Array<{
  pattern: RegExp
  handler: (params: Record<string, string>) => string
  notFoundCheck?: (params: Record<string, string>) => boolean
}> = [
  {
    pattern: /^\/admin\/users\/([^/]+)$/,
    handler: (params) => renderUserDetail(params.userId),
    notFoundCheck: (params) => params.userId?.startsWith('nonexistent'),
  },
  {
    pattern: /^\/admin\/integrations\/([^/]+)$/,
    handler: (params) => renderIntegrationDetail(params.integrationId),
    notFoundCheck: (params) => params.integrationId?.startsWith('nonexistent'),
  },
  {
    pattern: /^\/admin\/workflows\/([^/]+)\/runs\/([^/]+)$/,
    handler: (params) => renderWorkflowRunDetail(params.workflowId, params.runId),
    notFoundCheck: (params) => params.workflowId?.startsWith('nonexistent') || params.runId?.startsWith('nonexistent'),
  },
  {
    pattern: /^\/admin\/workflows\/([^/]+)\/runs$/,
    handler: (params) => renderWorkflowRuns(params.workflowId),
    notFoundCheck: (params) => params.workflowId?.startsWith('nonexistent'),
  },
  {
    pattern: /^\/admin\/workflows\/([^/]+)$/,
    handler: (params) => renderWorkflowDetail(params.workflowId),
    notFoundCheck: (params) => params.workflowId?.startsWith('nonexistent'),
  },
  {
    pattern: /^\/admin\/activity\/([^/]+)$/,
    handler: (params) => renderActivityLogDetail(params.logId),
    notFoundCheck: (params) => params.logId?.startsWith('nonexistent'),
  },
]

/**
 * Render a page with authentication (default behavior)
 */
export async function renderPage(path: string): Promise<Response> {
  return fetchPage(path, { authenticated: true })
}

/**
 * Fetch a page with optional authentication
 */
export async function fetchPage(
  path: string,
  options: { authenticated: boolean } = { authenticated: true }
): Promise<Response> {
  // Protected routes that require authentication
  const protectedPaths = [
    '/admin',
    '/admin/users',
    '/admin/integrations',
    '/admin/workflows',
    '/admin/activity',
    '/admin/settings',
  ]

  const isProtected = protectedPaths.some((p) => path === p || path.startsWith(p + '/'))
  const isLoginPage = path === '/admin/login'

  // Redirect to login if not authenticated and accessing protected route
  if (!options.authenticated && isProtected && !isLoginPage) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin/login',
      },
    })
  }

  // Login page is always accessible
  if (isLoginPage) {
    return new Response(renderLogin(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    })
  }

  // Check static routes first
  const staticHandler = routes[path]
  if (staticHandler) {
    const html = staticHandler()
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': 'session=test-session; Path=/; HttpOnly',
      },
    })
  }

  // Check dynamic routes
  for (const { pattern, handler, notFoundCheck } of dynamicRoutes) {
    const match = path.match(pattern)
    if (match) {
      const params: Record<string, string> = {}
      if (pattern.source.includes('users')) {
        params.userId = match[1]
      } else if (pattern.source.includes('integrations')) {
        params.integrationId = match[1]
      } else if (pattern.source.includes('workflows')) {
        params.workflowId = match[1]
        if (match[2]) params.runId = match[2]
      } else if (pattern.source.includes('activity')) {
        params.logId = match[1]
      }

      // Check if this is a not found case
      if (notFoundCheck && notFoundCheck(params)) {
        return new Response(render404(), {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        })
      }

      const html = handler(params)
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'session=test-session; Path=/; HttpOnly',
        },
      })
    }
  }

  // 404 for unknown routes
  return new Response(render404(), {
    status: 404,
    headers: {
      'Content-Type': 'text/html',
    },
  })
}

// ============================================================================
// Page Renderers
// ============================================================================

function wrapInLayout(content: string, title: string = 'Admin Dashboard'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - dotdo Admin</title>
</head>
<body>
  <a href="#main-content" class="skip-to-content">Skip to main content</a>
  <div data-shell class="flex min-h-screen">
    <nav class="sidebar w-64 bg-gray-900 text-white p-4 lg:block md:hidden mobile-toggle" aria-label="Main navigation">
      <div class="sidebar-header mb-8">
        <h2 class="text-xl font-bold">dotdo Admin</h2>
      </div>
      <ul class="space-y-2">
        <li><a href="/admin" class="block py-2 px-4 hover:bg-gray-800 rounded" aria-label="Dashboard">Dashboard</a></li>
        <li><a href="/admin/users" class="block py-2 px-4 hover:bg-gray-800 rounded" aria-label="Users">Users</a></li>
        <li><a href="/admin/integrations" class="block py-2 px-4 hover:bg-gray-800 rounded" aria-label="Integrations">Integrations</a></li>
        <li><a href="/admin/workflows" class="block py-2 px-4 hover:bg-gray-800 rounded" aria-label="Workflows">Workflows</a></li>
        <li><a href="/admin/activity" class="block py-2 px-4 hover:bg-gray-800 rounded" aria-label="Activity">Activity</a></li>
        <li><a href="/admin/settings" class="block py-2 px-4 hover:bg-gray-800 rounded" aria-label="Settings">Settings</a></li>
      </ul>
    </nav>
    <div class="flex-1 flex flex-col">
      <header class="bg-white border-b px-6 py-4 flex justify-between items-center">
        <h1 class="text-2xl font-semibold">${title}</h1>
        <div class="flex items-center gap-4">
          <div class="user-profile" aria-label="User profile">
            <img src="/avatar.png" alt="User avatar" class="w-8 h-8 rounded-full" />
          </div>
          <button class="logout-btn text-gray-600 hover:text-gray-800" aria-label="Sign out">Logout</button>
        </div>
      </header>
      <main id="main-content" class="flex-1 p-6 bg-gray-50">
        ${content}
      </main>
    </div>
  </div>
</body>
</html>`
}

function renderDashboard(): string {
  return wrapInLayout(
    `
    <div class="dashboard-view">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Overview</h2>
        <div class="period-selector">
          <select aria-label="Time period" class="border rounded px-3 py-1">
            <option value="day">Day</option>
            <option value="week" selected>Week</option>
            <option value="month">Month</option>
          </select>
        </div>
      </div>

      <div class="metrics-grid grid grid-cols-4 gap-4 mb-8">
        <div class="metric-card bg-white p-4 rounded-lg shadow">
          <h3 class="text-gray-500 text-sm">Durable Objects</h3>
          <p class="text-2xl font-bold">1,234</p>
        </div>
        <div class="metric-card bg-white p-4 rounded-lg shadow">
          <h3 class="text-gray-500 text-sm">Requests</h3>
          <p class="text-2xl font-bold">12,345</p>
        </div>
        <div class="metric-card bg-white p-4 rounded-lg shadow">
          <h3 class="text-gray-500 text-sm">Active Workflows</h3>
          <p class="text-2xl font-bold">56</p>
        </div>
        <div class="metric-card bg-white p-4 rounded-lg shadow">
          <h3 class="text-gray-500 text-sm">Users</h3>
          <p class="text-2xl font-bold">789</p>
        </div>
      </div>

      <div class="recent-activity bg-white p-6 rounded-lg shadow">
        <h3 class="text-lg font-semibold mb-4">Recent Activity</h3>
        <ul class="space-y-3">
          <li class="flex items-center gap-3">
            <span class="text-gray-500 text-sm">2 min ago</span>
            <span>User john@example.com created a new workflow</span>
          </li>
          <li class="flex items-center gap-3">
            <span class="text-gray-500 text-sm">5 min ago</span>
            <span>Integration GitHub connected</span>
          </li>
        </ul>
      </div>
    </div>
  `,
    'Dashboard'
  )
}

function renderLogin(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - dotdo Admin</title>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
    <h1 class="text-2xl font-bold mb-6 text-center">Admin Login</h1>
    <form action="/admin/login" method="POST">
      <div class="mb-4">
        <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input type="email" id="email" name="email" required class="w-full border rounded px-3 py-2" />
      </div>
      <div class="mb-6">
        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input type="password" id="password" name="password" required class="w-full border rounded px-3 py-2" />
      </div>
      <button type="submit" class="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
        Sign In
      </button>
    </form>
  </div>
</body>
</html>`
}

function renderUsersList(): string {
  return wrapInLayout(
    `
    <div class="users-page">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Users</h2>
        <a href="/admin/users/new" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Create User
        </a>
      </div>

      <div class="bg-white rounded-lg shadow">
        <div class="p-4 border-b">
          <input type="search" placeholder="Search users..." aria-label="Search users"
                 class="w-full border rounded px-3 py-2 filter-input" />
        </div>

        <table class="w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr>
              <td class="px-6 py-4">John Doe</td>
              <td class="px-6 py-4">john@example.com</td>
              <td class="px-6 py-4">Admin</td>
              <td class="px-6 py-4"><span class="text-green-600">Active</span></td>
              <td class="px-6 py-4"><a href="/admin/users/user-1">View</a></td>
            </tr>
            <tr>
              <td class="px-6 py-4">Jane Smith</td>
              <td class="px-6 py-4">jane@example.com</td>
              <td class="px-6 py-4">User</td>
              <td class="px-6 py-4"><span class="text-green-600">Active</span></td>
              <td class="px-6 py-4"><a href="/admin/users/user-2">View</a></td>
            </tr>
          </tbody>
        </table>

        <div class="p-4 border-t flex justify-between items-center">
          <span class="text-sm text-gray-500">Page 1 of 10</span>
          <div class="flex gap-2">
            <button class="px-3 py-1 border rounded" disabled>Previous</button>
            <button class="px-3 py-1 border rounded">Next</button>
          </div>
        </div>
      </div>
    </div>
  `,
    'Users'
  )
}

function renderUserDetail(userId: string): string {
  return wrapInLayout(
    `
    <div class="user-detail">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">User Details</h2>
        <div class="flex gap-2">
          <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Edit</button>
          <button class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">Delete</button>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Name</dt>
            <dd class="text-lg font-medium">John Doe</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Email</dt>
            <dd class="text-lg font-medium">john@example.com</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Role</dt>
            <dd class="text-lg font-medium">Admin</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Status</dt>
            <dd class="text-lg font-medium text-green-600">Active</dd>
          </div>
        </dl>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Activity History</h3>
        <ul class="space-y-3">
          <li class="flex items-center gap-3">
            <span class="text-gray-500 text-sm">2 hours ago</span>
            <span>Updated profile settings</span>
          </li>
          <li class="flex items-center gap-3">
            <span class="text-gray-500 text-sm">1 day ago</span>
            <span>Created new workflow</span>
          </li>
        </ul>
      </div>
    </div>
  `,
    'User Details'
  )
}

function renderUserCreate(): string {
  return wrapInLayout(
    `
    <div class="user-create">
      <h2 class="text-xl font-semibold mb-6">Create New User</h2>

      <form action="/admin/users" method="POST" class="bg-white rounded-lg shadow p-6 max-w-lg">
        <div class="mb-4">
          <label for="name" class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" id="name" name="name" required class="w-full border rounded px-3 py-2" />
        </div>

        <div class="mb-4">
          <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" id="email" name="email" required class="w-full border rounded px-3 py-2" />
        </div>

        <div class="mb-4">
          <label for="role" class="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select id="role" name="role" class="w-full border rounded px-3 py-2">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div class="flex gap-2">
          <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            Create User
          </button>
          <a href="/admin/users" class="px-4 py-2 border rounded hover:bg-gray-50">Cancel</a>
        </div>
      </form>
    </div>
  `,
    'Create User'
  )
}

function renderIntegrationsList(): string {
  return wrapInLayout(
    `
    <div class="integrations-page">
      <h2 class="text-xl font-semibold mb-6">Integrations</h2>

      <div class="grid grid-cols-2 gap-4">
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-gray-900 rounded flex items-center justify-center">
                <span class="text-white text-xl">G</span>
              </div>
              <div>
                <h3 class="font-semibold">GitHub</h3>
                <p class="text-sm text-gray-500">Provider</p>
              </div>
            </div>
            <span class="text-green-600 font-medium">Connected</span>
          </div>
          <p class="text-sm text-gray-600 mb-4">Connect your GitHub repositories for CI/CD workflows.</p>
          <div class="flex gap-2">
            <a href="/admin/integrations/github" class="text-blue-600 hover:underline">Configure</a>
            <button class="text-red-600 hover:underline">Disconnect</button>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-blue-600 rounded flex items-center justify-center">
                <span class="text-white text-xl">G</span>
              </div>
              <div>
                <h3 class="font-semibold">Google</h3>
                <p class="text-sm text-gray-500">Provider</p>
              </div>
            </div>
            <span class="text-gray-500 font-medium">Disconnected</span>
          </div>
          <p class="text-sm text-gray-600 mb-4">Integration with Google Workspace.</p>
          <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Connect</button>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-blue-500 rounded flex items-center justify-center">
                <span class="text-white text-xl">M</span>
              </div>
              <div>
                <h3 class="font-semibold">Microsoft</h3>
                <p class="text-sm text-gray-500">Provider</p>
              </div>
            </div>
            <span class="text-gray-500 font-medium">Disconnected</span>
          </div>
          <p class="text-sm text-gray-600 mb-4">Integration Status with Microsoft 365.</p>
          <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Connect</button>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-purple-600 rounded flex items-center justify-center">
                <span class="text-white text-xl">S</span>
              </div>
              <div>
                <h3 class="font-semibold">Slack</h3>
                <p class="text-sm text-gray-500">Provider</p>
              </div>
            </div>
            <span class="text-gray-500 font-medium">Disconnected</span>
          </div>
          <p class="text-sm text-gray-600 mb-4">Send notifications to Slack channels.</p>
          <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Connect</button>
        </div>
      </div>
    </div>
  `,
    'Integrations'
  )
}

function renderIntegrationDetail(integrationId: string): string {
  return wrapInLayout(
    `
    <div class="integration-detail">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">GitHub Configuration</h2>
        <button class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Test Connection</button>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Settings</h3>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Client ID</dt>
            <dd class="text-lg font-medium">gh_client_*****</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Token</dt>
            <dd class="text-lg font-medium">ghp_*****</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Credentials</dt>
            <dd class="text-lg font-medium">Configured</dd>
          </div>
        </dl>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Sync Status</h3>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Last Sync</dt>
            <dd class="text-lg font-medium">2 hours ago</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Status</dt>
            <dd class="text-lg font-medium text-green-600">Healthy</dd>
          </div>
        </dl>
      </div>
    </div>
  `,
    'GitHub Integration'
  )
}

function renderAPIKeys(): string {
  return wrapInLayout(
    `
    <div class="api-keys-page">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">API Keys</h2>
        <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Generate New Key
        </button>
      </div>

      <div class="bg-white rounded-lg shadow">
        <table class="w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Used</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr>
              <td class="px-6 py-4">Production API Key</td>
              <td class="px-6 py-4 font-mono">sk_live_****</td>
              <td class="px-6 py-4">Jan 1, 2024</td>
              <td class="px-6 py-4">2 hours ago</td>
              <td class="px-6 py-4">
                <button class="text-red-600 hover:underline">Revoke</button>
              </td>
            </tr>
            <tr>
              <td class="px-6 py-4">Development Key</td>
              <td class="px-6 py-4 font-mono">sk_test_****</td>
              <td class="px-6 py-4">Dec 15, 2023</td>
              <td class="px-6 py-4">1 day ago</td>
              <td class="px-6 py-4">
                <button class="text-red-600 hover:underline">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
    'API Keys'
  )
}

function renderWorkflowsList(): string {
  return wrapInLayout(
    `
    <div class="workflows-page">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Workflows</h2>
        <div class="flex gap-4">
          <select class="border rounded px-3 py-2" aria-label="Filter by status">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="failed">Failed</option>
          </select>
          <input type="search" placeholder="Search workflows..." aria-label="Search workflows"
                 class="border rounded px-3 py-2" />
        </div>
      </div>

      <div class="bg-white rounded-lg shadow">
        <table class="w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr>
              <td class="px-6 py-4">Data Sync Workflow</td>
              <td class="px-6 py-4"><span class="text-green-600">Active</span></td>
              <td class="px-6 py-4">2 hours ago</td>
              <td class="px-6 py-4">
                <a href="/admin/workflows/workflow-1" class="text-blue-600 hover:underline">View</a>
              </td>
            </tr>
            <tr>
              <td class="px-6 py-4">Email Notification</td>
              <td class="px-6 py-4"><span class="text-yellow-600">Paused</span></td>
              <td class="px-6 py-4">1 day ago</td>
              <td class="px-6 py-4">
                <a href="/admin/workflows/workflow-2" class="text-blue-600 hover:underline">View</a>
              </td>
            </tr>
            <tr>
              <td class="px-6 py-4">Backup Job</td>
              <td class="px-6 py-4"><span class="text-red-600">Failed</span></td>
              <td class="px-6 py-4">3 hours ago</td>
              <td class="px-6 py-4">
                <a href="/admin/workflows/workflow-3" class="text-blue-600 hover:underline">View</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
    'Workflows'
  )
}

function renderWorkflowDetail(workflowId: string): string {
  return wrapInLayout(
    `
    <div class="workflow-detail">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Workflow Details</h2>
        <div class="flex gap-2">
          <button class="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700">Pause</button>
          <button class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Run Now</button>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Configuration</h3>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Name</dt>
            <dd class="text-lg font-medium">Data Sync Workflow</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Status</dt>
            <dd class="text-lg font-medium text-green-600">Active</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Trigger</dt>
            <dd class="text-lg font-medium">Schedule (Every hour)</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Event</dt>
            <dd class="text-lg font-medium">on_data_change</dd>
          </div>
        </dl>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold">Recent Runs</h3>
          <a href="/admin/workflows/${workflowId}/runs" class="text-blue-600 hover:underline">View All Executions</a>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between py-2 border-b">
            <span>Run #123</span>
            <span class="text-green-600">Success</span>
          </div>
          <div class="flex items-center justify-between py-2 border-b">
            <span>Run #122</span>
            <span class="text-green-600">Success</span>
          </div>
          <div class="flex items-center justify-between py-2">
            <span>Run #121</span>
            <span class="text-red-600">Failed</span>
          </div>
        </div>
      </div>
    </div>
  `,
    'Workflow Details'
  )
}

function renderWorkflowRuns(workflowId: string): string {
  return wrapInLayout(
    `
    <div class="workflow-runs">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Workflow Runs</h2>
        <select class="border rounded px-3 py-2" aria-label="Filter by status">
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div class="bg-white rounded-lg shadow">
        <table class="w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Run ID</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr>
              <td class="px-6 py-4">run-123</td>
              <td class="px-6 py-4">2024-01-08 10:30:00</td>
              <td class="px-6 py-4">2m 30s</td>
              <td class="px-6 py-4"><span class="text-green-600">Success</span></td>
              <td class="px-6 py-4">
                <a href="/admin/workflows/${workflowId}/runs/run-123" class="text-blue-600 hover:underline">View Logs</a>
              </td>
            </tr>
            <tr>
              <td class="px-6 py-4">run-122</td>
              <td class="px-6 py-4">2024-01-08 09:30:00</td>
              <td class="px-6 py-4">3m 15s</td>
              <td class="px-6 py-4"><span class="text-red-600">Failed</span></td>
              <td class="px-6 py-4">
                <a href="/admin/workflows/${workflowId}/runs/run-122" class="text-blue-600 hover:underline">View Details</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
    'Workflow Runs'
  )
}

function renderWorkflowRunDetail(workflowId: string, runId: string): string {
  return wrapInLayout(
    `
    <div class="run-detail">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Run Details: ${runId}</h2>
        <a href="/admin/workflows/${workflowId}/runs" class="text-blue-600 hover:underline">Back to Runs</a>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Timeline</h3>
        <div class="space-y-4">
          <div class="flex items-start gap-4">
            <div class="w-3 h-3 bg-green-500 rounded-full mt-1.5"></div>
            <div>
              <p class="font-medium">Step 1: Initialize</p>
              <p class="text-sm text-gray-500">Duration: 0.5s | Time: 10:30:00</p>
            </div>
          </div>
          <div class="flex items-start gap-4">
            <div class="w-3 h-3 bg-green-500 rounded-full mt-1.5"></div>
            <div>
              <p class="font-medium">Stage 2: Process Data</p>
              <p class="text-sm text-gray-500">Duration: 1m 30s</p>
            </div>
          </div>
          <div class="flex items-start gap-4">
            <div class="w-3 h-3 bg-green-500 rounded-full mt-1.5"></div>
            <div>
              <p class="font-medium">Step 3: Complete</p>
              <p class="text-sm text-gray-500">Duration: 0.2s</p>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Input/Output Data</h3>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <h4 class="font-medium mb-2">Input</h4>
            <pre class="bg-gray-100 p-4 rounded text-sm overflow-auto">{"source": "api", "count": 100}</pre>
          </div>
          <div>
            <h4 class="font-medium mb-2">Output</h4>
            <pre class="bg-gray-100 p-4 rounded text-sm overflow-auto">{"processed": 100, "status": "success"}</pre>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Logs</h3>
        <pre class="bg-gray-900 text-green-400 p-4 rounded text-sm overflow-auto">
[10:30:00] Starting workflow execution...
[10:30:01] Processing 100 records...
[10:31:30] All records processed successfully
[10:31:32] Workflow completed
        </pre>
      </div>
    </div>
  `,
    'Run Details'
  )
}

function renderActivityLogs(): string {
  return wrapInLayout(
    `
    <div class="activity-logs">
      <h2 class="text-xl font-semibold mb-6">Activity Logs</h2>

      <div class="bg-white rounded-lg shadow mb-4 p-4">
        <div class="flex gap-4">
          <input type="search" placeholder="Search logs..." aria-label="Search logs"
                 class="flex-1 border rounded px-3 py-2" />
          <select class="border rounded px-3 py-2" aria-label="Filter by action">
            <option value="">All Actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="login">Login</option>
          </select>
          <select class="border rounded px-3 py-2" aria-label="Filter by user">
            <option value="">All Users</option>
            <option value="user-1">John Doe</option>
            <option value="user-2">Jane Smith</option>
          </select>
          <div class="flex gap-2">
            <input type="date" class="border rounded px-3 py-2" aria-label="From date" />
            <span class="self-center">To</span>
            <input type="date" class="border rounded px-3 py-2" aria-label="To date" />
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow">
        <table class="w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr>
              <td class="px-6 py-4">2024-01-08 10:30:00</td>
              <td class="px-6 py-4">John Doe</td>
              <td class="px-6 py-4"><span class="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">Create</span></td>
              <td class="px-6 py-4">Workflow</td>
              <td class="px-6 py-4"><a href="/admin/activity/log-1" class="text-blue-600 hover:underline">View</a></td>
            </tr>
            <tr>
              <td class="px-6 py-4">2024-01-08 09:15:00</td>
              <td class="px-6 py-4">Jane Smith</td>
              <td class="px-6 py-4"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">Update</span></td>
              <td class="px-6 py-4">Integration</td>
              <td class="px-6 py-4"><a href="/admin/activity/log-2" class="text-blue-600 hover:underline">View</a></td>
            </tr>
            <tr>
              <td class="px-6 py-4">2024-01-08 08:00:00</td>
              <td class="px-6 py-4">John Doe</td>
              <td class="px-6 py-4"><span class="bg-purple-100 text-purple-800 px-2 py-1 rounded text-sm">Login</span></td>
              <td class="px-6 py-4">Session</td>
              <td class="px-6 py-4"><a href="/admin/activity/log-3" class="text-blue-600 hover:underline">View</a></td>
            </tr>
          </tbody>
        </table>

        <div class="p-4 border-t flex justify-between items-center">
          <span class="text-sm text-gray-500">Page 1 of 50</span>
          <div class="flex gap-2">
            <button class="px-3 py-1 border rounded" disabled>Previous</button>
            <button class="px-3 py-1 border rounded">Next</button>
          </div>
        </div>
      </div>
    </div>
  `,
    'Activity Logs'
  )
}

function renderActivityLogDetail(logId: string): string {
  return wrapInLayout(
    `
    <div class="activity-detail">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold">Activity Details</h2>
        <a href="/admin/activity" class="text-blue-600 hover:underline">Back to Logs</a>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Information</h3>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Timestamp</dt>
            <dd class="text-lg font-medium">2024-01-08 10:30:00</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">User</dt>
            <dd class="text-lg font-medium">John Doe</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Action</dt>
            <dd class="text-lg font-medium">Create</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Resource</dt>
            <dd class="text-lg font-medium">Workflow</dd>
          </div>
        </dl>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Request Metadata</h3>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">IP Address</dt>
            <dd class="text-lg font-medium">192.168.1.1</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">User Agent</dt>
            <dd class="text-lg font-medium">Mozilla/5.0 Chrome/120.0</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Request ID</dt>
            <dd class="text-lg font-medium">req_abc123</dd>
          </div>
        </dl>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Changes</h3>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <h4 class="font-medium mb-2">Before</h4>
            <pre class="bg-gray-100 p-4 rounded text-sm overflow-auto">null</pre>
          </div>
          <div>
            <h4 class="font-medium mb-2">After</h4>
            <pre class="bg-gray-100 p-4 rounded text-sm overflow-auto">{"name": "New Workflow", "status": "active"}</pre>
          </div>
        </div>
        <p class="mt-4 text-sm text-gray-500">Modified fields: name, status</p>
      </div>
    </div>
  `,
    'Activity Details'
  )
}

function renderSettings(): string {
  return wrapInLayout(
    `
    <div class="settings-page">
      <h2 class="text-xl font-semibold mb-6">Settings</h2>

      <div class="grid grid-cols-3 gap-6">
        <a href="/admin/settings/account" class="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
          <h3 class="text-lg font-semibold mb-2">Account & Profile</h3>
          <p class="text-gray-600">Manage your personal information and preferences.</p>
        </a>

        <a href="/admin/settings/security" class="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
          <h3 class="text-lg font-semibold mb-2">Security & Password</h3>
          <p class="text-gray-600">Update password, Two-Factor authentication (2FA), and sessions.</p>
        </a>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-2">Notification Preferences</h3>
          <p class="text-gray-600">Configure Email alerts and notifications.</p>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-2">Appearance & Theme</h3>
          <p class="text-gray-600">Customize the look with Dark Mode and themes.</p>
        </div>
      </div>
    </div>
  `,
    'Settings'
  )
}

function renderAccountSettings(): string {
  return wrapInLayout(
    `
    <div class="account-settings">
      <h2 class="text-xl font-semibold mb-6">Account Settings</h2>

      <form action="/admin/settings/account" method="POST" class="bg-white rounded-lg shadow p-6 max-w-lg">
        <div class="mb-6">
          <label for="avatar" class="block text-sm font-medium text-gray-700 mb-2">Profile Photo</label>
          <div class="flex items-center gap-4">
            <img src="/avatar.png" alt="Current avatar" class="w-16 h-16 rounded-full" />
            <button type="button" class="px-4 py-2 border rounded hover:bg-gray-50">Change</button>
          </div>
        </div>

        <div class="mb-4">
          <label for="name" class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" id="name" name="name" value="John Doe" class="w-full border rounded px-3 py-2" />
        </div>

        <div class="mb-4">
          <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" id="email" name="email" value="john@example.com" readonly
                 class="w-full border rounded px-3 py-2 bg-gray-50" />
          <p class="text-sm text-gray-500 mt-1">Contact support to change your email.</p>
        </div>

        <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Save Changes
        </button>
      </form>
    </div>
  `,
    'Account Settings'
  )
}

function renderSecuritySettings(): string {
  return wrapInLayout(
    `
    <div class="security-settings">
      <h2 class="text-xl font-semibold mb-6">Security Settings</h2>

      <div class="space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-4">Password</h3>
          <form action="/admin/settings/security/password" method="POST" class="max-w-lg">
            <div class="mb-4">
              <label for="current-password" class="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input type="password" id="current-password" name="currentPassword" class="w-full border rounded px-3 py-2" />
            </div>
            <div class="mb-4">
              <label for="new-password" class="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input type="password" id="new-password" name="newPassword" class="w-full border rounded px-3 py-2" />
            </div>
            <div class="mb-4">
              <label for="confirm-password" class="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" id="confirm-password" name="confirmPassword" class="w-full border rounded px-3 py-2" />
            </div>
            <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Update Password
            </button>
          </form>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-4">Two-Factor Authentication (2FA/MFA)</h3>
          <p class="text-gray-600 mb-4">Add an extra layer of security to your account.</p>
          <div class="flex items-center gap-4">
            <span class="text-gray-500">Status: Disabled</span>
            <button class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Enable 2FA</button>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-4">Active Sessions</h3>
          <p class="text-gray-600 mb-4">Manage devices and sessions where you're logged in.</p>
          <ul class="space-y-3 mb-4">
            <li class="flex items-center justify-between py-2 border-b">
              <div>
                <p class="font-medium">Chrome on macOS (Current Device)</p>
                <p class="text-sm text-gray-500">Last active: Just now</p>
              </div>
            </li>
            <li class="flex items-center justify-between py-2">
              <div>
                <p class="font-medium">Safari on iPhone</p>
                <p class="text-sm text-gray-500">Last active: 2 hours ago</p>
              </div>
              <button class="text-red-600 hover:underline">Revoke</button>
            </li>
          </ul>
          <button class="text-red-600 hover:underline">Sign Out All Other Sessions</button>
        </div>
      </div>
    </div>
  `,
    'Security Settings'
  )
}

function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 Not Found - dotdo Admin</title>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-6xl font-bold text-gray-300 mb-4">404</h1>
    <p class="text-xl text-gray-600 mb-6">Page Not Found</p>
    <p class="text-gray-500 mb-8">The page you're looking for doesn't exist or has been moved.</p>
    <a href="/admin" class="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700">
      Back to Dashboard
    </a>
  </div>
</body>
</html>`
}
