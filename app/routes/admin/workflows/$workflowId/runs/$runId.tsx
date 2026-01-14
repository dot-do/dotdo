/**
 * Admin Workflow Run Detail Route
 *
 * Displays detailed information about a specific workflow run.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/workflows/$workflowId/runs/$runId')({
  component: WorkflowRunDetailPage,
})

function WorkflowRunDetailPage() {
  const { workflowId, runId } = Route.useParams()

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Run Details: {runId}</h1>
          <a href={`/admin/workflows/${workflowId}/runs`} className="text-blue-600 hover:underline">
            Back to Runs
          </a>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Timeline</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-3 h-3 bg-green-500 rounded-full mt-1.5"></div>
              <div>
                <p className="font-medium">Step 1: Initialize</p>
                <p className="text-sm text-gray-500">Duration: 0.5s | Time: 10:30:00</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-3 h-3 bg-green-500 rounded-full mt-1.5"></div>
              <div>
                <p className="font-medium">Stage 2: Process Data</p>
                <p className="text-sm text-gray-500">Duration: 1m 30s</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-3 h-3 bg-green-500 rounded-full mt-1.5"></div>
              <div>
                <p className="font-medium">Step 3: Complete</p>
                <p className="text-sm text-gray-500">Duration: 0.2s</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Input/Output Data</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-2">Input</h4>
              <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
                {JSON.stringify({ source: 'api', count: 100 }, null, 2)}
              </pre>
            </div>
            <div>
              <h4 className="font-medium mb-2">Output</h4>
              <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
                {JSON.stringify({ processed: 100, status: 'success' }, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Logs</h3>
          <pre className="bg-gray-900 text-green-400 p-4 rounded text-sm overflow-auto">
            {`[10:30:00] Starting workflow execution...
[10:30:01] Processing 100 records...
[10:31:30] All records processed successfully
[10:31:32] Workflow completed`}
          </pre>
        </div>
      </div>
    </Shell>
  )
}
