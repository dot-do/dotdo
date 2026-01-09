/**
 * ApprovalDetail Component
 *
 * Displays detailed information about an approval request.
 */

interface ApprovalDetailProps {
  approvalId: string
}

export function ApprovalDetail({ approvalId }: ApprovalDetailProps) {
  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold">Approval Request</h1>
        <p className="text-muted-foreground">ID: {approvalId}</p>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="font-semibold mb-2">Details</h2>
        <p className="text-sm text-muted-foreground">
          Approval details will be loaded here.
        </p>
      </div>
    </div>
  )
}
