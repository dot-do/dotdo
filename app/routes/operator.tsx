// Operator Dashboard - Main entry point
// Provides monitoring and management for dotdo deployments
import { createFileRoute } from '@tanstack/react-router'
import { PageLayout } from '../components/Layout'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/operator')({
  component: OperatorDashboard,
})

function OperatorDashboard() {
  return (
    <PageLayout
      title="Operator Dashboard"
      subtitle="Monitor and manage your dotdo infrastructure"
      maxWidth="full"
    >
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <DashboardCard
          title="DO Overview"
          description="View all Durable Objects, state, storage usage, and health status"
          href="/operator/objects"
          icon={<ObjectsIcon />}
          color="blue"
        />
        <DashboardCard
          title="Event Monitoring"
          description="Real-time event stream, history, filtering, and dead letter queue"
          href="/operator/events"
          icon={<EventsIcon />}
          color="green"
        />
        <DashboardCard
          title="Analytics"
          description="Request counts, error rates, latency metrics, and performance"
          href="/operator/analytics"
          icon={<AnalyticsIcon />}
          color="purple"
        />
        <DashboardCard
          title="Admin Operations"
          description="View/edit DO state, trigger event replay, clear storage"
          href="/operator/admin"
          icon={<AdminIcon />}
          color="orange"
        />
      </div>

      {/* Quick Stats */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">System Overview</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Active DOs"
            value="--"
            trend={null}
            description="Durable Objects with recent activity"
          />
          <StatCard
            label="Events/min"
            value="--"
            trend={null}
            description="Events processed in the last minute"
          />
          <StatCard
            label="Error Rate"
            value="--"
            trend={null}
            description="Errors in the last hour"
          />
          <StatCard
            label="Avg Latency"
            value="--"
            trend={null}
            description="Average request latency"
          />
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">Recent Events</h3>
          <div className="text-gray-500 text-sm">
            Connect to a DO to view real-time events
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">System Health</h3>
          <div className="space-y-3">
            <HealthIndicator name="API" status="unknown" />
            <HealthIndicator name="Workers" status="unknown" />
            <HealthIndicator name="Storage" status="unknown" />
            <HealthIndicator name="WebSocket" status="unknown" />
          </div>
        </div>
      </div>
    </PageLayout>
  )
}

interface DashboardCardProps {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'orange'
}

const colorClasses = {
  blue: 'bg-blue-50 border-blue-200 hover:border-blue-400',
  green: 'bg-green-50 border-green-200 hover:border-green-400',
  purple: 'bg-purple-50 border-purple-200 hover:border-purple-400',
  orange: 'bg-orange-50 border-orange-200 hover:border-orange-400',
}

const iconColorClasses = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  purple: 'text-purple-600',
  orange: 'text-orange-600',
}

function DashboardCard({ title, description, href, icon, color }: DashboardCardProps) {
  return (
    <Link
      to={href}
      className={`block border rounded-lg p-6 transition-all ${colorClasses[color]}`}
    >
      <div className={`mb-3 ${iconColorClasses[color]}`}>{icon}</div>
      <h3 className="text-lg font-semibold mb-2 text-gray-900">{title}</h3>
      <p className="text-gray-600 text-sm">{description}</p>
    </Link>
  )
}

interface StatCardProps {
  label: string
  value: string
  trend: 'up' | 'down' | null
  description: string
}

function StatCard({ label, value, trend, description }: StatCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline space-x-2">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        {trend && (
          <span className={trend === 'up' ? 'text-green-600' : 'text-red-600'}>
            {trend === 'up' ? '+' : '-'}
          </span>
        )}
      </div>
      <div className="text-xs text-gray-400 mt-1">{description}</div>
    </div>
  )
}

interface HealthIndicatorProps {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
}

function HealthIndicator({ name, status }: HealthIndicatorProps) {
  const statusColors = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    unhealthy: 'bg-red-500',
    unknown: 'bg-gray-400',
  }

  const statusLabels = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    unhealthy: 'Unhealthy',
    unknown: 'Unknown',
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{name}</span>
      <div className="flex items-center space-x-2">
        <span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
        <span className="text-sm text-gray-500">{statusLabels[status]}</span>
      </div>
    </div>
  )
}

// Icons

function ObjectsIcon() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  )
}

function EventsIcon() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

function AnalyticsIcon() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function AdminIcon() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
