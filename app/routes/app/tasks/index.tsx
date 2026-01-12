/**
 * Tasks Index Route
 *
 * Lists all tasks for the user at /app/tasks.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button } from '@mdxui/primitives/button'
import { PageHeader } from '../_app'

export const Route = createFileRoute('/app/tasks/')({
  component: TasksPage,
})

function TasksPage() {
  return (
    <>
      <PageHeader>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Task
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Tasks</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Manage your tasks
        </p>

        {/* Tasks list placeholder */}
        <div className="rounded-lg border">
          <div className="p-8 text-center text-muted-foreground">
            <p>No tasks yet. Create your first task to get started.</p>
          </div>
        </div>
      </div>
    </>
  )
}
