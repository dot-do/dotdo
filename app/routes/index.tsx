import { createFileRoute } from '@tanstack/react-router'
import { PageLayout } from '../components/Layout'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <PageLayout
      title="Welcome to dotdo"
      subtitle="Business-as-Code. Services-as-Software."
    >
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          title="Durable Objects"
          description="SQLite-backed Durable Objects with Things, Relationships, and Events"
        />
        <FeatureCard
          title="Event Streams"
          description="Fire-and-forget events with $.send() and durable actions with $.do()"
        />
        <FeatureCard
          title="RPC Layer"
          description="Type-safe Cap'n Web RPC for cross-DO communication"
        />
        <FeatureCard
          title="AI Module"
          description="Template literals and multi-provider LLM routing"
        />
        <FeatureCard
          title="Capabilities"
          description="Extended primitives: fsx, gitx, bashx, npmx, pyx"
        />
        <FeatureCard
          title="Workflows"
          description="Fluent DSL with $.on, $.every, and pipeline patterns"
        />
      </div>
    </PageLayout>
  )
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-lg font-semibold mb-2 text-gray-900">{title}</h3>
      <p className="text-gray-600 text-sm">{description}</p>
    </div>
  )
}
