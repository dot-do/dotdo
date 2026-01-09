/**
 * Approval Detail Page Route
 *
 * Individual approval detail page with decision form and context display.
 * Supports dynamic form rendering based on HumanFunction definition.
 *
 * @see app/tests/approvals/approval-detail.test.tsx
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { ApprovalDetail } from '../../../components/approvals/approval-detail'
import { ApprovalForm } from '../../../components/approvals/approval-form'

export const Route = createFileRoute('/admin/approvals/$approvalId')({
  component: ApprovalDetailPage,
})

function ApprovalDetailPage() {
  const { approvalId } = Route.useParams()

  return (
    <Shell>
      <ApprovalDetail approvalId={approvalId} />
    </Shell>
  )
}
