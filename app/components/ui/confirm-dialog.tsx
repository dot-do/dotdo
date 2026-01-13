/**
 * Confirmation Dialog Component
 *
 * A reusable confirmation dialog for destructive or important actions.
 * Built on top of Radix Dialog primitives.
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Button } from './button'

// =============================================================================
// Types
// =============================================================================

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Title of the confirmation dialog */
  title: string
  /** Description explaining what the user is confirming */
  description: string
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string
  /** Variant for the confirm button (default: "destructive" for delete actions) */
  variant?: 'default' | 'destructive'
  /** Callback when user confirms the action */
  onConfirm: () => void | Promise<void>
  /** Whether the confirm action is in progress */
  isLoading?: boolean
}

// =============================================================================
// Component
// =============================================================================

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  onConfirm,
  isLoading = false,
}: ConfirmDialogProps) {
  const [isPending, setIsPending] = React.useState(false)

  const handleConfirm = async () => {
    setIsPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      // Allow parent to handle errors
      throw error
    } finally {
      setIsPending(false)
    }
  }

  const loading = isLoading || isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            onClick={handleConfirm}
            disabled={loading}
            data-testid="confirm-dialog-confirm"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing...
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Hook for convenience
// =============================================================================

interface UseConfirmDialogOptions {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
}

interface UseConfirmDialogReturn {
  /** Open the confirmation dialog */
  confirm: () => Promise<boolean>
  /** Props to spread on ConfirmDialog */
  dialogProps: Omit<ConfirmDialogProps, 'onConfirm'>
}

/**
 * Hook for programmatic confirmation dialogs
 *
 * @example
 * ```tsx
 * const { confirm, dialogProps } = useConfirmDialog({
 *   title: 'Delete Session',
 *   description: 'Are you sure you want to revoke this session?',
 * })
 *
 * const handleDelete = async () => {
 *   const confirmed = await confirm()
 *   if (confirmed) {
 *     await deleteSession()
 *   }
 * }
 *
 * return (
 *   <>
 *     <button onClick={handleDelete}>Delete</button>
 *     <ConfirmDialog {...dialogProps} onConfirm={() => {}} />
 *   </>
 * )
 * ```
 */
export function useConfirmDialog(options: UseConfirmDialogOptions): UseConfirmDialogReturn {
  const [open, setOpen] = React.useState(false)
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null)

  const confirm = React.useCallback(() => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setOpen(true)
    })
  }, [])

  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen && resolveRef.current) {
      resolveRef.current(false)
      resolveRef.current = null
    }
  }, [])

  const dialogProps: Omit<ConfirmDialogProps, 'onConfirm'> = {
    open,
    onOpenChange: handleOpenChange,
    title: options.title,
    description: options.description,
    confirmLabel: options.confirmLabel,
    cancelLabel: options.cancelLabel,
    variant: options.variant,
  }

  return { confirm, dialogProps }
}
