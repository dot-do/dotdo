/**
 * Workflows Index Route
 *
 * Lists all workflows for the user at /app/workflows.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button } from '@mdxui/primitives/button'
import { PageHeader } from '../_app'

export const Route = createFileRoute('/app/workflows/')({
  component: WorkflowsPage,
})

function WorkflowsPage() {
  return (
    <>
      <PageHeader>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Workflow
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Workflows</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Manage your workflows
        </p>

        {/* Workflows list placeholder */}
        <div className="rounded-lg border">
          <div className="p-8 text-center text-muted-foreground">
            <p>No workflows yet. Create your first workflow to automate tasks.</p>
          </div>
        </div>
      </div>
    </>
  )
}
