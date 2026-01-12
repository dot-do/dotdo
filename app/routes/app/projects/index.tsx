/**
 * Projects Index Route
 *
 * Lists all projects for the user at /app/projects.
 * Includes page header with title, description, and create action.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button } from '@mdxui/primitives/button'
import { PageHeader } from '../_app'

export const Route = createFileRoute('/app/projects/')({
  component: ProjectsPage,
})

function ProjectsPage() {
  return (
    <>
      <PageHeader>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Project
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Projects</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Manage your projects
        </p>

        {/* Projects list placeholder */}
        <div className="rounded-lg border">
          <div className="p-8 text-center text-muted-foreground">
            <p>No projects yet. Create your first project to get started.</p>
          </div>
        </div>
      </div>
    </>
  )
}
