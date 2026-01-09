/**
 * ApprovalForm Component
 *
 * Dynamic form renderer that creates form fields from HumanFunction definitions.
 * Supports text, number, boolean, select, multiselect, textarea, date, and file fields.
 */

import * as React from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Checkbox } from '../ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import type { FormFieldDefinition, FormDefinition, ApprovalAction } from '../../types/approval'

// =============================================================================
// Component Props
// =============================================================================

export interface ApprovalFormProps {
  form?: FormDefinition
  actions?: ApprovalAction[]
  onSubmit: (action: string, data: { formData?: Record<string, unknown>; reason?: string }) => void
  isSubmitting?: boolean
  requiresConfirmation?: boolean
  highValueThreshold?: number
  formData?: Record<string, unknown>
  className?: string
}

// =============================================================================
// Field Components
// =============================================================================

interface FieldProps {
  field: FormFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  error?: string
}

function TextField({ field, value, onChange, error }: FieldProps) {
  return (
    <Input
      id={field.name}
      type="text"
      value={(value as string) || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      minLength={field.validation?.minLength}
      maxLength={field.validation?.maxLength}
      required={field.required}
      aria-invalid={!!error}
      aria-describedby={field.description ? `${field.name}-description` : undefined}
    />
  )
}

function NumberField({ field, value, onChange, error }: FieldProps) {
  return (
    <Input
      id={field.name}
      type="number"
      value={value !== undefined ? String(value) : ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={field.placeholder}
      min={field.validation?.min}
      max={field.validation?.max}
      step="any"
      required={field.required}
      aria-invalid={!!error}
    />
  )
}

function BooleanField({ field, value, onChange }: FieldProps) {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={field.name}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked)}
      />
      <Label htmlFor={field.name} className="text-sm font-normal">
        {field.label}
      </Label>
    </div>
  )
}

function SelectField({ field, value, onChange, error }: FieldProps) {
  return (
    <Select
      value={(value as string) || ''}
      onValueChange={(v) => onChange(v)}
    >
      <SelectTrigger id={field.name} aria-invalid={!!error}>
        <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        {field.options?.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MultiselectField({ field, value, onChange }: FieldProps) {
  const selectedValues = (value as string[]) || []

  const toggleOption = (option: string) => {
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter((v) => v !== option))
    } else {
      onChange([...selectedValues, option])
    }
  }

  return (
    <div role="listbox" aria-label={field.label} className="space-y-2">
      {field.options?.map((option) => (
        <div key={option} className="flex items-center space-x-2">
          <Checkbox
            id={`${field.name}-${option}`}
            checked={selectedValues.includes(option)}
            onCheckedChange={() => toggleOption(option)}
          />
          <Label htmlFor={`${field.name}-${option}`} className="text-sm font-normal">
            {option}
          </Label>
        </div>
      ))}
    </div>
  )
}

function TextareaField({ field, value, onChange, error }: FieldProps) {
  return (
    <textarea
      id={field.name}
      value={(value as string) || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      minLength={field.validation?.minLength}
      maxLength={field.validation?.maxLength}
      required={field.required}
      aria-invalid={!!error}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'ring-offset-background placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
    />
  )
}

function DateField({ field, value, onChange, error }: FieldProps) {
  return (
    <Input
      id={field.name}
      type="date"
      value={(value as string) || ''}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      aria-invalid={!!error}
    />
  )
}

function FileField({ field, onChange, error }: FieldProps) {
  return (
    <Input
      id={field.name}
      type="file"
      onChange={(e) => {
        const files = e.target.files
        onChange(files ? Array.from(files) : [])
      }}
      required={field.required}
      aria-invalid={!!error}
    />
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function ApprovalForm({
  form,
  actions,
  onSubmit,
  isSubmitting = false,
  requiresConfirmation = false,
  highValueThreshold = 5000,
  formData: initialFormData,
  className,
}: ApprovalFormProps) {
  const [formData, setFormData] = React.useState<Record<string, unknown>>(initialFormData || {})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [showReasonDialog, setShowReasonDialog] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false)

  // Initialize form with default values
  React.useEffect(() => {
    if (form?.fields) {
      const defaults: Record<string, unknown> = {}
      form.fields.forEach((field) => {
        if (field.default !== undefined) {
          defaults[field.name] = field.default
        }
      })
      setFormData((prev) => ({ ...defaults, ...prev }))
    }
  }, [form])

  const updateField = (name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
    // Clear error when field is updated
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    form?.fields.forEach((field) => {
      const value = formData[field.name]

      if (field.required && (value === undefined || value === '' || value === null)) {
        newErrors[field.name] = `${field.label} is required`
      }

      if (field.type === 'number' && value !== undefined) {
        const numValue = value as number
        if (field.validation?.min !== undefined && numValue < field.validation.min) {
          newErrors[field.name] = `${field.label} must be at least ${field.validation.min}`
        }
        if (field.validation?.max !== undefined && numValue > field.validation.max) {
          newErrors[field.name] = `${field.label} must be at most ${field.validation.max}`
        }
      }

      if (field.type === 'text' && typeof value === 'string') {
        if (field.validation?.minLength && value.length < field.validation.minLength) {
          newErrors[field.name] = `${field.label} must be at least ${field.validation.minLength} characters`
        }
        if (field.validation?.maxLength && value.length > field.validation.maxLength) {
          newErrors[field.name] = `${field.label} must be at most ${field.validation.maxLength} characters`
        }
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleActionClick = (action: ApprovalAction) => {
    // Check if this action requires a reason
    if (action.requiresReason) {
      setPendingAction(action.value)
      setShowReasonDialog(true)
      return
    }

    // Check for high-value confirmation
    const amountField = form?.fields.find((f) => f.name.toLowerCase().includes('amount'))
    const amount = amountField ? (formData[amountField.name] as number) : 0
    if (requiresConfirmation && amount >= highValueThreshold) {
      setPendingAction(action.value)
      setShowConfirmDialog(true)
      return
    }

    // Validate and submit
    if (!validateForm()) return
    onSubmit(action.value, { formData })
  }

  const handleReasonSubmit = () => {
    if (!reason.trim()) {
      return
    }

    if (!validateForm()) {
      setShowReasonDialog(false)
      return
    }

    onSubmit(pendingAction!, { formData, reason })
    setShowReasonDialog(false)
    setPendingAction(null)
    setReason('')
  }

  const handleConfirmSubmit = () => {
    onSubmit(pendingAction!, { formData })
    setShowConfirmDialog(false)
    setPendingAction(null)
  }

  const renderField = (field: FormFieldDefinition) => {
    const value = formData[field.name]
    const error = errors[field.name]
    const fieldProps: FieldProps = { field, value, onChange: (v) => updateField(field.name, v), error }

    // For boolean fields, render differently (checkbox includes label)
    if (field.type === 'boolean') {
      return (
        <div key={field.name} data-form-field className="space-y-2">
          <BooleanField {...fieldProps} />
          {field.description && (
            <p id={`${field.name}-description`} className="text-sm text-gray-500">
              {field.description}
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )
    }

    const fieldComponents: Record<FormFieldDefinition['type'], React.FC<FieldProps>> = {
      text: TextField,
      number: NumberField,
      boolean: BooleanField,
      select: SelectField,
      multiselect: MultiselectField,
      textarea: TextareaField,
      date: DateField,
      file: FileField,
    }

    const FieldComponent = fieldComponents[field.type] || TextField

    return (
      <div key={field.name} data-form-field className="space-y-2">
        <Label htmlFor={field.name}>
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <FieldComponent {...fieldProps} />
        {field.description && (
          <p id={`${field.name}-description`} className="text-sm text-gray-500">
            {field.description}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  const defaultActions: ApprovalAction[] = [
    { value: 'approve', label: 'Approve', style: 'primary' },
    { value: 'reject', label: 'Reject', style: 'danger', requiresReason: true },
  ]

  const displayActions = actions && actions.length > 0 ? actions : defaultActions

  return (
    <div data-approval-form className={className}>
      {/* Form Fields */}
      {form && form.fields.length > 0 && (
        <form className="space-y-4 mb-6" onSubmit={(e) => e.preventDefault()}>
          {form.fields.map(renderField)}
        </form>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {displayActions.map((action) => (
          <Button
            key={action.value}
            onClick={() => handleActionClick(action)}
            disabled={isSubmitting}
            variant={
              action.style === 'primary' ? 'default' :
              action.style === 'danger' ? 'destructive' : 'outline'
            }
            className={cn(
              'min-h-11 min-w-11 flex-1 sm:flex-none',
              action.style === 'primary' && 'bg-primary',
              action.style === 'danger' && 'bg-destructive'
            )}
          >
            {isSubmitting && pendingAction === action.value && (
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {action.label}
          </Button>
        ))}
      </div>

      {/* Reason Dialog */}
      {showReasonDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Provide a Reason</h3>
            <p className="text-sm text-gray-500 mb-4">
              Please provide a reason for this action. A reason is required.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter your reason..."
              className="w-full border rounded-md p-2 min-h-[100px] mb-4"
              aria-label="Reason"
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowReasonDialog(false)
                  setPendingAction(null)
                  setReason('')
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleReasonSubmit} disabled={!reason.trim()}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Confirm Action</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to proceed? This is a high-value approval.
              {formData.refundAmount && (
                <span className="block mt-2 font-semibold">
                  Amount: ${Number(formData.refundAmount).toLocaleString()}
                </span>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowConfirmDialog(false)
                  setPendingAction(null)
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmSubmit}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
