import * as React from 'react'
import { cn } from '../../lib/utils'
import { CheckIcon } from 'lucide-react'

export interface CheckboxProps extends Omit<React.ComponentProps<'button'>, 'onChange'> {
  checked?: boolean | 'indeterminate'
  onCheckedChange?: (checked: boolean | 'indeterminate') => void
}

/**
 * Checkbox component compatible with testing-library and Radix patterns.
 * Uses a button element with proper aria attributes for accessibility.
 */
export function Checkbox({
  checked = false,
  onCheckedChange,
  className,
  disabled,
  onClick,
  ...props
}: CheckboxProps) {
  const dataState = checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked'
  const ariaChecked = checked === 'indeterminate' ? 'mixed' : checked ? 'true' : 'false'

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (!disabled && !e.defaultPrevented) {
      const newValue = checked === 'indeterminate' ? true : !checked
      onCheckedChange?.(newValue)
    }
  }, [checked, disabled, onClick, onCheckedChange])

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ariaChecked}
      data-state={dataState}
      data-slot="checkbox"
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center justify-center',
        className
      )}
      {...props}
    >
      {(checked === true || checked === 'indeterminate') && (
        <span data-slot="checkbox-indicator" className="grid place-content-center text-current">
          {checked === 'indeterminate' ? (
            <span className="size-2 bg-current rounded-sm" />
          ) : (
            <CheckIcon className="size-3" />
          )}
        </span>
      )}
    </button>
  )
}
