// Documentation - see do-7rf.8.3
import { createFileRoute, Link } from '@tanstack/react-router'
import { PageLayout } from '../components/Layout'

export const Route = createFileRoute('/docs')({
  component: DocsPage,
})

function DocsPage() {
  return (
    <PageLayout
      title="Documentation"
      subtitle="Learn how to build with dotdo"
      maxWidth="full"
    >
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold text-blue-900 mb-2">
          In Development
        </h2>
        <p className="text-blue-800">
          Documentation integration with fumadocs is in progress. See issue{' '}
          <code className="bg-blue-100 px-2 py-1 rounded text-sm">
            do-7rf.8.3
          </code>{' '}
          for details.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <nav className="sticky top-4 bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/"
                  className="text-primary-600 hover:text-primary-700 text-sm"
                >
                  Getting Started
                </Link>
              </li>
              <li>
                <a
                  href="#core-concepts"
                  className="text-gray-600 hover:text-gray-900 text-sm"
                >
                  Core Concepts
                </a>
              </li>
              <li>
                <a
                  href="#api-reference"
                  className="text-gray-600 hover:text-gray-900 text-sm"
                >
                  API Reference
                </a>
              </li>
              <li>
                <a
                  href="#guides"
                  className="text-gray-600 hover:text-gray-900 text-sm"
                >
                  Guides
                </a>
              </li>
              <li>
                <a
                  href="#examples"
                  className="text-gray-600 hover:text-gray-900 text-sm"
                >
                  Examples
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <section id="core-concepts">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Core Concepts
            </h2>
            <div className="space-y-4">
              <DocCard
                title="Durable Objects"
                description="SQLite-backed Durable Objects with Things, Relationships, and Events stores"
              />
              <DocCard
                title="WorkflowContext ($)"
                description="The $ context provides event handling, scheduling, and RPC capabilities"
              />
              <DocCard
                title="Event System"
                description="Fire-and-forget with $.send(), single-attempt with $.try(), durable with $.do()"
              />
              <DocCard
                title="RPC Layer"
                description="Type-safe Cap'n Web RPC for cross-DO communication"
              />
            </div>
          </section>

          <section id="api-reference">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              API Reference
            </h2>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
              <p className="text-gray-600">
                Comprehensive API documentation coming soon with fumadocs
                integration.
              </p>
            </div>
          </section>

          <section id="guides">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Guides</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <GuideCard title="Quick Start" status="planned" />
              <GuideCard title="Event Handlers" status="planned" />
              <GuideCard title="Scheduling" status="planned" />
              <GuideCard title="Storage Patterns" status="planned" />
            </div>
          </section>

          <section id="examples">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Examples</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <GuideCard title="Todo App" status="planned" />
              <GuideCard title="E-commerce" status="planned" />
              <GuideCard title="Chat Application" status="planned" />
              <GuideCard title="Workflow Engine" status="planned" />
            </div>
          </section>
        </div>
      </div>
    </PageLayout>
  )
}

interface DocCardProps {
  title: string
  description: string
}

function DocCard({ title, description }: DocCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 hover:border-primary-300 transition-colors">
      <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  )
}

interface GuideCardProps {
  title: string
  status: 'available' | 'planned'
}

function GuideCard({ title, status }: GuideCardProps) {
  const statusColors = {
    available: 'bg-green-100 text-green-800',
    planned: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-gray-900">{title}</h4>
        <span
          className={`text-xs px-2 py-1 rounded-full ${statusColors[status]}`}
        >
          {status}
        </span>
      </div>
    </div>
  )
}
