'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

/**
 * Field configuration for SyncForm
 */
export interface FieldConfig {
  /** Field name (must match schema field) */
  name: string
  /** Display label */
  label: string
  /** Field type */
  type: 'text' | 'email' | 'select' | 'checkbox' | 'textarea' | 'password' | 'number'
  /** Options for select fields */
  options?: { value: string; label: string }[]
  /** Whether field is required */
  required?: boolean
  /** Field description/help text */
  description?: string
  /** Placeholder text */
  placeholder?: string
  /** Whether field is disabled */
  disabled?: boolean
}

/**
 * Minimal field interface expected from TanStack Form's field API
 */
interface FieldState {
  value: unknown
  meta: {
    errors?: string[]
    isTouched?: boolean
  }
}

/**
 * Minimal field API interface expected from TanStack Form
 */
interface MinimalFieldApi {
  name: string
  state: FieldState
  handleChange: (value: unknown) => void
  handleBlur: () => void
}

/**
 * Minimal form API interface expected from TanStack Form (useSyncForm)
 */
export interface MinimalFormApi<TFormData extends Record<string, unknown> = Record<string, unknown>> {
  state: {
    values: TFormData
    isSubmitting?: boolean
    canSubmit?: boolean
  }
  Field: React.ComponentType<{
    name: string
    children: (field: MinimalFieldApi) => React.ReactNode
  }>
}

/**
 * Props for the SyncForm component
 */
export interface SyncFormProps<TFormData extends Record<string, unknown> = Record<string, unknown>> {
  /** TanStack Form instance from useSyncForm */
  form: MinimalFormApi<TFormData>
  /** Field configurations */
  fields: FieldConfig[]
  /** Submit handler */
  onSubmit: () => Promise<void> | void
  /** Cancel handler */
  onCancel?: () => void
  /** Submit button label */
  submitLabel?: string
  /** Cancel button label */
  cancelLabel?: string
  /** Whether form is currently submitting */
  isSubmitting?: boolean
  /** Additional className for form element */
  className?: string
}

/**
 * SyncForm component for rendering forms that sync with Durable Objects
 *
 * Uses TanStack Form for state management and shadcn/ui for rendering.
 * Designed to work with useSyncForm hook from @dotdo/tanstack.
 *
 * @example
 * ```tsx
 * const { form, isSubmitting, submit } = useSyncForm({
 *   collection,
 *   schema: UserSchema,
 * })
 *
 * <SyncForm
 *   form={form}
 *   fields={[
 *     { name: 'name', label: 'Name', type: 'text', required: true },
 *     { name: 'email', label: 'Email', type: 'email', required: true },
 *     { name: 'role', label: 'Role', type: 'select', options: roleOptions },
 *   ]}
 *   onSubmit={submit}
 *   isSubmitting={isSubmitting}
 *   submitLabel="Save User"
 * />
 * ```
 */
export function SyncForm<TFormData extends Record<string, unknown>>({
  form,
  fields,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  isSubmitting = false,
  className,
}: SyncFormProps<TFormData>) {
  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await onSubmit()
    },
    [onSubmit]
  )

  // Use form.Field component from TanStack Form
  const FormField = form.Field

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-6', className)}>
      {fields.map((fieldConfig) => (
        <FormField key={fieldConfig.name} name={fieldConfig.name}>
          {(field) => (
            <SyncFormField
              field={field}
              config={fieldConfig}
              disabled={isSubmitting || fieldConfig.disabled}
            />
          )}
        </FormField>
      ))}

      <div className="flex items-center gap-4 pt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  )
}

/**
 * Internal component for rendering individual form fields
 */
interface SyncFormFieldProps {
  field: MinimalFieldApi
  config: FieldConfig
  disabled?: boolean
}

function SyncFormField({ field, config, disabled }: SyncFormFieldProps) {
  const { label, type, required, description } = config
  const errors = field.state.meta.errors
  const hasError = errors && errors.length > 0
  const fieldId = `sync-form-${field.name}`

  return (
    <div className="grid gap-2">
      {type !== 'checkbox' && (
        <Label htmlFor={fieldId} className={cn(hasError && 'text-destructive')}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}

      {renderFieldInput({ field, config, disabled, fieldId })}

      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}

      {hasError && (
        <p className="text-destructive text-sm" role="alert">
          {errors.join(', ')}
        </p>
      )}
    </div>
  )
}

/**
 * Render the appropriate input component based on field type
 */
function renderFieldInput({
  field,
  config,
  disabled,
  fieldId,
}: {
  field: MinimalFieldApi
  config: FieldConfig
  disabled?: boolean
  fieldId: string
}) {
  const { type, options, placeholder, label, required } = config
  const value = field.state.value
  const errors = field.state.meta.errors
  const hasError = errors && errors.length > 0

  switch (type) {
    case 'text':
    case 'email':
    case 'password':
    case 'number':
      return (
        <Input
          id={fieldId}
          type={type}
          name={field.name}
          value={(value as string) ?? ''}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={field.handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${fieldId}-error` : undefined}
        />
      )

    case 'textarea':
      return (
        <Textarea
          id={fieldId}
          name={field.name}
          value={(value as string) ?? ''}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={field.handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${fieldId}-error` : undefined}
        />
      )

    case 'select':
      if (!options || options.length === 0) {
        console.warn(`SyncForm: No options provided for select field "${field.name}"`)
        return null
      }
      return (
        <Select
          name={field.name}
          value={(value as string) ?? ''}
          onValueChange={(newValue) => field.handleChange(newValue)}
          disabled={disabled}
        >
          <SelectTrigger id={fieldId} className="w-full" aria-invalid={hasError}>
            <SelectValue placeholder={placeholder ?? `Select ${label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={fieldId}
            name={field.name}
            checked={(value as boolean) ?? false}
            onCheckedChange={(checked) => field.handleChange(checked)}
            onBlur={field.handleBlur}
            disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={hasError ? `${fieldId}-error` : undefined}
          />
          <Label
            htmlFor={fieldId}
            className={cn(
              'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
              hasError && 'text-destructive'
            )}
          >
            {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </Label>
        </div>
      )

    default:
      console.warn(`SyncForm: Unknown field type "${type}"`)
      return null
  }
}
