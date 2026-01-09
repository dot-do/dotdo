/**
 * ApprovalChain Component
 *
 * Displays multi-level approval workflow visualization.
 * Shows sequential, parallel, and conditional workflows.
 */

import * as React from 'react'
import { cn } from '../../lib/utils'
import type { ApprovalWorkflow, ApprovalLevel } from '../../types/approval'

// =============================================================================
// Component Props
// =============================================================================

export interface ApprovalChainProps {
  workflow: ApprovalWorkflow
  className?: string
}

// =============================================================================
// Helper Components
// =============================================================================

interface LevelIndicatorProps {
  level: ApprovalLevel
  index: number
  isCurrent: boolean
  isCompleted: boolean
}

function LevelIndicator({ level, index, isCurrent, isCompleted }: LevelIndicatorProps) {
  return (
    <div
      data-level
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border-2',
        isCurrent && 'border-blue-500 bg-blue-50',
        isCompleted && 'border-green-500 bg-green-50',
        !isCurrent && !isCompleted && 'border-gray-200 bg-gray-50'
      )}
    >
      {/* Status Icon */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-white font-medium',
          isCompleted && 'bg-green-500',
          isCurrent && 'bg-blue-500',
          !isCurrent && !isCompleted && 'bg-gray-300'
        )}
      >
        {isCompleted ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          index + 1
        )}
      </div>

      {/* Level Info */}
      <div className="flex-1">
        <div className="font-medium text-gray-900">{level.name}</div>
        <div className="text-sm text-gray-500">
          {isCompleted && level.completedBy && (
            <span>
              Completed by {level.completedBy}
              {level.completedAt && (
                <> at {new Date(level.completedAt).toLocaleString()}</>
              )}
            </span>
          )}
          {isCurrent && (
            <span className="text-blue-600">Awaiting approval</span>
          )}
          {!isCurrent && !isCompleted && (
            <span className="text-gray-400">Pending</span>
          )}
        </div>
        {level.users && level.users.length > 0 && (
          <div className="text-xs text-gray-400 mt-1">
            Assigned to: {level.users.join(', ')}
          </div>
        )}
      </div>

      {/* Action Badge */}
      {isCompleted && level.action && (
        <span
          className={cn(
            'px-2 py-1 rounded text-xs font-medium',
            level.action === 'approve' && 'bg-green-100 text-green-800',
            level.action === 'reject' && 'bg-red-100 text-red-800'
          )}
        >
          {level.action}
        </span>
      )}
    </div>
  )
}

function SequentialConnector() {
  return (
    <div className="flex justify-center py-2">
      <div className="flex flex-col items-center">
        <div className="w-0.5 h-4 bg-gray-300" />
        <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function ApprovalChain({ workflow, className }: ApprovalChainProps) {
  const currentLevel = workflow.currentLevel ?? 0
  const levels = workflow.levels || []

  if (levels.length === 0) {
    return null
  }

  return (
    <div data-approval-chain className={cn('space-y-2', className)}>
      {/* Workflow Type Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-700">
          {workflow.type === 'sequential' && (
            <>
              <svg className="w-4 h-4 inline-block mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10.293 15.707a1 1 0 010-1.414L14.586 10l-4.293-4.293a1 1 0 111.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Sequential Approval
            </>
          )}
          {workflow.type === 'parallel' && (
            <>
              <svg className="w-4 h-4 inline-block mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
              </svg>
              Parallel Approval
            </>
          )}
          {workflow.type === 'conditional' && (
            <>
              <svg className="w-4 h-4 inline-block mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Conditional Approval
            </>
          )}
        </span>
        {workflow.requiredApprovals && (
          <span className="text-sm text-gray-500">
            ({workflow.approvals?.length || 0} of {workflow.requiredApprovals} required)
          </span>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>
            {currentLevel} of {workflow.totalLevels || levels.length} steps
          </span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{
              width: `${((currentLevel) / (workflow.totalLevels || levels.length)) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Levels */}
      <div className="space-y-0">
        {levels.map((level, index) => {
          const isCompleted = level.status === 'completed' || index < currentLevel
          const isCurrent = index === currentLevel

          return (
            <React.Fragment key={level.name}>
              {index > 0 && workflow.type === 'sequential' && <SequentialConnector />}
              <LevelIndicator
                level={level}
                index={index}
                isCurrent={isCurrent}
                isCompleted={isCompleted}
              />
            </React.Fragment>
          )
        })}
      </div>

      {/* Completed Approvals Summary */}
      {workflow.approvals && workflow.approvals.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Approval History</h4>
          <div className="space-y-2">
            {workflow.approvals.map((approval, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    approval.action === 'approve' && 'bg-green-500',
                    approval.action === 'reject' && 'bg-red-500'
                  )}
                />
                <span className="font-medium">{approval.userName}</span>
                <span className="text-gray-500">{approval.action}</span>
                {approval.level && <span className="text-gray-400">at {approval.level}</span>}
                <span className="text-gray-400 text-xs ml-auto">
                  {new Date(approval.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
