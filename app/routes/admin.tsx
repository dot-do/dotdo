// Admin portal - see do-7rf.8.4
import { createFileRoute } from '@tanstack/react-router'
import { PageLayout } from '../components/Layout'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

function AdminPage() {
  return (
    <PageLayout
      title="Admin Portal"
      subtitle="Manage your dotdo infrastructure"
      maxWidth="full"
    >
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold text-yellow-900 mb-2">
          In Development
        </h2>
        <p className="text-yellow-800">
          Admin portal UI integration with @mdxui/do is in progress. See issue{' '}
          <code className="bg-yellow-100 px-2 py-1 rounded text-sm">
            do-7rf.8.4
          </code>{' '}
          for details.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <AdminCard
          title="Durable Objects"
          description="View and manage DO instances, inspect state, and monitor performance"
          status="planned"
        />
        <AdminCard
          title="Event Streams"
          description="Monitor event pipelines, replay events, and debug workflows"
          status="planned"
        />
        <AdminCard
          title="Storage"
          description="Inspect Things, Relationships, and Events across namespaces"
          status="planned"
        />
        <AdminCard
          title="RPC Calls"
          description="View active RPC connections and trace cross-DO communication"
          status="planned"
        />
        <AdminCard
          title="AI Usage"
          description="Monitor LLM usage, costs, and prompt performance metrics"
          status="planned"
        />
        <AdminCard
          title="System Health"
          description="View system status, resource usage, and error rates"
          status="planned"
        />
      </div>
    </PageLayout>
  )
}

interface AdminCardProps {
  title: string
  description: string
  status: 'active' | 'planned' | 'beta'
}

function AdminCard({ title, description, status }: AdminCardProps) {
  const statusColors = {
    active: 'bg-green-100 text-green-800',
    planned: 'bg-gray-100 text-gray-600',
    beta: 'bg-blue-100 text-blue-800',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <span
          className={`text-xs px-2 py-1 rounded-full ${statusColors[status]}`}
        >
          {status}
        </span>
      </div>
      <p className="text-gray-600 text-sm">{description}</p>
    </div>
  )
}
