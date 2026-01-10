/**
 * useSyncForm Hook
 *
 * Integrates TanStack Form with a collection from useCollection for
 * type-safe forms with real-time sync and optimistic updates.
 *
 * @module app/lib/hooks/use-sync-form
 *
 * Features:
 * - Create mode: form starts empty, calls collection.insert on submit
 * - Edit mode: loads data from collection.findById(initialId), calls collection.update on submit
 * - Validates using Zod schema via TanStack Form validators
 *
 * @example Create mode
 * ```tsx
 * const { form, submit, isSubmitting } = useSyncForm({
 *   collection: tasksCollection,
 *   schema: TaskSchema,
 *   onSuccess: () => navigate('/tasks'),
 * })
 *
 * return (
 *   <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
 *     <form.Field name="title" children={(field) => (
 *       <input value={field.state.value} onChange={e => field.handleChange(e.target.value)} />
 *     )} />
 *     <button disabled={isSubmitting}>Create</button>
 *   </form>
 * )
 * ```
 *
 * @example Edit mode
 * ```tsx
 * const { form, isEditing, submit } = useSyncForm({
 *   collection: tasksCollection,
 *   schema: TaskSchema,
 *   initialId: taskId, // Enables edit mode
 * })
 *
 * // form.state.values is pre-populated with existing data
 * ```
 *
 * @see app/tests/hooks/use-sync-form.test.ts for test coverage
 */

import { useCallback, useMemo, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import type { z, ZodObject, ZodRawShape, ZodError } from 'zod'

// =============================================================================
// Types
// =============================================================================

/**
 * Collection interface matching useCollection return value
 * @typeParam T - The item type, must have $id field
 * @internal
 */
interface Collection<T extends { $id: string }> {
  /** Find item by ID */
  findById: (id: string) => T | null
  /** Get all items */
  findAll: () => readonly T[]
  /** Insert new item */
  insert: (data: Omit<T, '$id'>) => Promise<T>
  /** Update existing item */
  update: (id: string, data: Partial<Omit<T, '$id'>>) => Promise<T>
  /** Delete item */
  delete: (id: string) => Promise<{ deleted: boolean } | void>
  /** Loading state */
  isLoading: boolean
  /** Error state */
  error: Error | null
}

/**
 * Options for the useSyncForm hook
 * @typeParam TSchema - The Zod schema type
 */
export interface UseSyncFormOptions<TSchema extends ZodObject<ZodRawShape>> {
  /**
   * The collection to sync with
   * Form submissions will call insert/update on this collection
   */
  collection: Collection<z.infer<TSchema> & { $id: string }>
  /**
   * Zod schema for form validation
   * Used for both field-level and form-level validation
   */
  schema: TSchema
  /**
   * Item ID for edit mode
   * When provided, form loads existing data and uses update on submit
   * When omitted, form starts empty and uses insert on submit
   */
  initialId?: string
  /**
   * Callback invoked on successful submit
   * Use for navigation, toast messages, etc.
   */
  onSuccess?: () => void
  /**
   * Callback invoked on submit error
   * Receives the error that caused the failure
   */
  onError?: (error: Error) => void
}

/**
 * Return value from the useSyncForm hook
 * @typeParam TSchema - The Zod schema type
 */
export interface UseSyncFormReturn<TSchema extends ZodObject<ZodRawShape>> {
  /**
   * TanStack Form instance
   * Use for field bindings and form state access
   */
  form: ReturnType<typeof useForm<z.infer<TSchema>>>
  /**
   * True when editing existing item, false when creating new
   * Determined by whether initialId was provided
   */
  readonly isEditing: boolean
  /**
   * True while form is submitting to the collection
   */
  readonly isSubmitting: boolean
  /**
   * Submit the form
   * Validates, then calls collection.insert (create) or collection.update (edit)
   * @throws Re-throws errors after calling onError
   */
  submit: () => Promise<void>
  /**
   * Reset form to initial values
   * For create mode: clears to schema defaults
   * For edit mode: reloads from collection
   */
  reset: () => void
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Gets the type name from a Zod field, handling both Zod v3 and v4
 */
function getZodTypeName(def: Record<string, unknown>): string | undefined {
  // Zod v4 uses 'type' directly
  if (typeof def.type === 'string') {
    return def.type
  }
  // Zod v3 uses 'typeName'
  if (typeof def.typeName === 'string') {
    return def.typeName
  }
  return undefined
}

/**
 * Extracts default values from a Zod schema
 * Supports both Zod v3 and v4 structures
 */
function getDefaultsFromSchema<TSchema extends ZodObject<ZodRawShape>>(
  schema: TSchema
): z.infer<TSchema> {
  const shape = schema.shape
  const defaults: Record<string, unknown> = {}

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const zodField = fieldSchema as z.ZodTypeAny

    if ('_def' in zodField) {
      const def = zodField._def as Record<string, unknown>
      const typeName = getZodTypeName(def)

      // Handle ZodDefault wrapper (both v3 and v4)
      if (typeName === 'default' || typeName === 'ZodDefault') {
        // Zod v4: defaultValue is a direct value
        // Zod v3: defaultValue might be a function
        const defaultVal = def.defaultValue
        defaults[key] = typeof defaultVal === 'function' ? defaultVal() : defaultVal
        continue
      }

      // Handle inner types for optional/nullable that might have defaults
      if ((typeName === 'optional' || typeName === 'ZodOptional') && def.innerType) {
        const innerDef = (def.innerType as z.ZodTypeAny)?._def as Record<string, unknown> | undefined
        if (innerDef) {
          const innerTypeName = getZodTypeName(innerDef)
          if (innerTypeName === 'default' || innerTypeName === 'ZodDefault') {
            const defaultVal = innerDef.defaultValue
            defaults[key] = typeof defaultVal === 'function' ? defaultVal() : defaultVal
            continue
          }
        }
        // Optional fields without defaults are undefined
        defaults[key] = undefined
        continue
      }

      // Fallback defaults based on type
      switch (typeName) {
        case 'string':
        case 'ZodString':
          defaults[key] = ''
          break
        case 'number':
        case 'ZodNumber':
          defaults[key] = 0
          break
        case 'boolean':
        case 'ZodBoolean':
          defaults[key] = false
          break
        case 'array':
        case 'ZodArray':
          defaults[key] = []
          break
        case 'object':
        case 'ZodObject':
          defaults[key] = {}
          break
        default:
          defaults[key] = undefined
      }
    }
  }

  return defaults as z.infer<TSchema>
}

/**
 * Strips the $id field from an object for insert/update operations
 */
function stripId<T extends Record<string, unknown>>(data: T): Omit<T, '$id'> {
  const { $id, ...rest } = data
  return rest as Omit<T, '$id'>
}

/**
 * Creates a form validation function for a Zod schema that returns
 * string error messages instead of raw Zod issues.
 * Compatible with TanStack Form v1.27.7
 */
function createFormValidator<TSchema extends ZodObject<ZodRawShape>>(
  schema: TSchema
) {
  return (opts: { value: z.infer<TSchema> }) => {
    const result = schema.safeParse(opts.value)
    if (result.success) return undefined

    // Extract errors from Zod result and return in the format expected by TanStack Form
    const zodError = result.error as ZodError
    const fields: Record<string, string[]> = {}

    for (const issue of zodError.issues) {
      const path = issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.')
      if (path) {
        if (!fields[path]) {
          fields[path] = []
        }
        fields[path].push(issue.message)
      }
    }

    // Return the global form validation error structure
    return {
      form: zodError.issues.map((i) => i.message),
      fields,
    }
  }
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * A hook that integrates TanStack Form with a collection for synchronized
 * form state management with Zod validation.
 *
 * @example
 * ```tsx
 * const { form, isEditing, isSubmitting, submit } = useSyncForm({
 *   collection: tasksCollection,
 *   schema: TaskSchema,
 *   initialId: editingTaskId, // optional - enables edit mode
 *   onSuccess: () => navigate('/tasks'),
 *   onError: (err) => toast.error(err.message),
 * })
 * ```
 */
export function useSyncForm<TSchema extends ZodObject<ZodRawShape>>(
  options: UseSyncFormOptions<TSchema>
): UseSyncFormReturn<TSchema> {
  const { collection, schema, initialId, onSuccess, onError } = options

  const [isSubmitting, setIsSubmitting] = useState(false)

  // Determine if we're in edit mode
  const isEditing = !!initialId

  // Get initial values - either from collection (edit) or schema defaults (create)
  const initialValues = useMemo(() => {
    if (initialId) {
      const existing = collection.findById(initialId)
      if (existing) {
        // Strip $id from the values for the form
        const { $id, ...values } = existing
        return values as z.infer<TSchema>
      }
    }
    return getDefaultsFromSchema(schema)
  }, [initialId, collection, schema])

  // Create the form validator function that returns string errors
  const formValidator = useMemo(() => createFormValidator(schema), [schema])

  // Create the TanStack Form instance with custom Zod validator
  const baseForm = useForm<z.infer<TSchema>>({
    defaultValues: initialValues,
    validators: {
      onChange: formValidator,
    },
  })

  // Wrap the form to enhance validateField and getFieldMeta to work with form-level validators
  // when no field instance is registered (common in tests and headless usage)
  const form = useMemo(() => {
    const originalValidateField = baseForm.validateField.bind(baseForm)
    const originalGetFieldMeta = baseForm.getFieldMeta.bind(baseForm)

    const enhancedForm = {
      ...baseForm,
      validateField: async (field: string, cause: 'change' | 'blur' | 'submit' | 'mount') => {
        // First try the standard validateField (works if field is registered)
        const result = originalValidateField(field, cause)

        // If no field instance, fall back to form-level validation
        // and extract errors for this specific field
        if (!baseForm.fieldInfo[field]?.instance) {
          // Run form validation to populate fieldMeta
          await baseForm.validate(cause)
          const meta = originalGetFieldMeta(field)
          // Flatten errors since there's no field instance to do it
          const flattenedErrors = meta?.errors?.flat(1) ?? []
          return flattenedErrors
        }

        return result
      },
      getFieldMeta: (field: string) => {
        const meta = originalGetFieldMeta(field)
        if (!meta) return meta

        // If no field instance, flatten errors manually
        // (TanStack Form only flattens when field instance exists)
        if (!baseForm.fieldInfo[field]?.instance && Array.isArray(meta.errors)) {
          return {
            ...meta,
            errors: meta.errors.flat(1),
          }
        }
        return meta
      },
    }

    // Copy over getters and special properties
    Object.defineProperty(enhancedForm, 'state', {
      get: () => baseForm.state,
    })

    return enhancedForm as typeof baseForm
  }, [baseForm])

  // Submit handler
  const submit = useCallback(async () => {
    // Set submitting immediately for UI feedback
    setIsSubmitting(true)

    try {
      // Validate the form first using form-level validation
      await baseForm.validate('change')

      // Check if form has errors in errorMap or fieldMeta
      const formErrors = baseForm.state.errorMap
      const hasFormErrors = Object.values(formErrors).some(
        (error) => error !== undefined && error !== null && error !== ''
      )

      // Also check field-level errors
      const hasFieldErrors = Object.values(baseForm.state.fieldMeta).some(
        (meta) => {
          if (!meta) return false
          const errors = meta.errors
          if (Array.isArray(errors) && errors.length > 0) return true
          if (meta.errorMap) {
            return Object.values(meta.errorMap).some(
              (e) => e !== undefined && e !== null && e !== ''
            )
          }
          return false
        }
      )

      if (hasFormErrors || hasFieldErrors || !baseForm.state.isValid) {
        return
      }

      const values = baseForm.state.values

      if (isEditing && initialId) {
        // Update existing item
        await collection.update(initialId, stripId(values as Record<string, unknown>))
      } else {
        // Insert new item
        await collection.insert(stripId(values as Record<string, unknown>))
      }

      onSuccess?.()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      onError?.(err)
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }, [baseForm, isEditing, initialId, collection, onSuccess, onError])

  // Reset handler
  const reset = useCallback(() => {
    form.reset()
  }, [form])

  return {
    form,
    isEditing,
    isSubmitting,
    submit,
    reset,
  }
}
