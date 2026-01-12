/**
 * New Project Route
 *
 * Create a new project at /app/projects/new.
 */

import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '../_app'

export const Route = createFileRoute('/app/projects/new')({
  component: NewProjectPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: search.create === true || search.create === 'true',
  }),
})

function NewProjectPage() {
  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Create Project</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Set up a new project
        </p>

        {/* Project creation form placeholder */}
        <div className="rounded-lg border p-6 max-w-2xl">
          <form className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Project Name
              </label>
              <input
                id="name"
                type="text"
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Enter project name"
              />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium mb-2">
                Description
              </label>
              <textarea
                id="description"
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Enter project description"
                rows={3}
              />
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
