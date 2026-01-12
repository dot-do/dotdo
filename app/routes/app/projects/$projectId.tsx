/**
 * Project Detail Route
 *
 * Shows details for a specific project at /app/projects/:projectId.
 * Used for testing nested breadcrumbs.
 */

import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '../_app'

export const Route = createFileRoute('/app/projects/$projectId')({
  component: ProjectDetailPage,
})

function ProjectDetailPage() {
  const { projectId } = Route.useParams()

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Project #{projectId}</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Project details and configuration
        </p>

        {/* Project detail placeholder */}
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Project Details</h2>
          <dl className="grid gap-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">ID</dt>
              <dd className="text-sm">{projectId}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="text-sm">Active</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="text-sm">January 1, 2026</dd>
            </div>
          </dl>
        </div>
      </div>
    </>
  )
}
