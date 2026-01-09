/**
 * Admin Dashboard Index Route
 *
 * Main dashboard page displaying dotdo metrics and overview.
 * Uses @mdxui/cockpit Shell and DashboardView components.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DashboardView } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

function AdminDashboard() {
  return (
    <Shell
      brand={{ name: '.do', href: '/' }}
      nav={[
        { label: 'Overview', href: '/admin', icon: 'Home' },
        { label: 'Agents', href: '/admin/agents', icon: 'Users' },
        { label: 'Workflows', href: '/admin/workflows', icon: 'GitBranch' },
        { label: 'Activity', href: '/admin/activity', icon: 'Activity' },
        { label: 'Integrations', href: '/admin/integrations', icon: 'Plug' },
        { label: 'Settings', href: '/admin/settings', icon: 'Settings' },
      ]}
    >
      <DashboardView
        title="Your 1-Person Unicorn"
        description="Autonomous business control center"
        period="week"
        metrics={[
          { label: 'Active Agents', value: 7, trend: { value: 0, direction: 'neutral' } },
          { label: 'Workflows Running', value: 12, trend: { value: 3, direction: 'up' } },
          { label: 'Events Today', value: 1248, trend: { value: 15, direction: 'up' } },
          { label: 'Human Escalations', value: 2, trend: { value: -1, direction: 'down' } },
        ]}
      />

      {/* Team Status */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {[
          { name: 'Priya', role: 'Product', status: 'working' },
          { name: 'Ralph', role: 'Engineering', status: 'building' },
          { name: 'Tom', role: 'Tech Lead', status: 'reviewing' },
          { name: 'Rae', role: 'Frontend', status: 'idle' },
          { name: 'Mark', role: 'Marketing', status: 'writing' },
          { name: 'Sally', role: 'Sales', status: 'outreach' },
          { name: 'Quinn', role: 'QA', status: 'testing' },
        ].map((agent) => (
          <div
            key={agent.name}
            className="p-4 bg-gray-900 rounded-lg border border-gray-800 text-center"
          >
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold">
              {agent.name[0]}
            </div>
            <div className="font-medium text-sm">{agent.name}</div>
            <div className="text-xs text-gray-500">{agent.role}</div>
            <div className="mt-1">
              <span
                className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                  agent.status === 'idle'
                    ? 'bg-gray-700 text-gray-400'
                    : 'bg-green-900/50 text-green-400'
                }`}
              >
                {agent.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mt-8 p-6 bg-gray-900 rounded-lg border border-gray-800">
        <h3 className="font-semibold mb-4">Quick Actions</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <button className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition text-left">
            <div className="font-medium">Ask Priya</div>
            <div className="text-sm text-gray-400">What should we build next?</div>
          </button>
          <button className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition text-left">
            <div className="font-medium">Deploy with Ralph</div>
            <div className="text-sm text-gray-400">Ship the next feature</div>
          </button>
          <button className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition text-left">
            <div className="font-medium">Review with Tom</div>
            <div className="text-sm text-gray-400">Code review request</div>
          </button>
        </div>
      </div>
    </Shell>
  )
}
