/**
 * Approval History Page Route
 *
 * Displays completed approvals with full audit trail.
 * Supports filtering by date range, user, and outcome.
 *
 * @see app/tests/approvals/approval-history.test.tsx
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { Shell } from '@mdxui/cockpit'
import { ApprovalHistory } from '../../../components/approvals/approval-history'

export const Route = createFileRoute('/admin/approvals/history')({
  component: ApprovalHistoryPage,
})

function ApprovalHistoryPage() {
  return (
    <Shell>
      <ApprovalHistory />
    </Shell>
  )
}
