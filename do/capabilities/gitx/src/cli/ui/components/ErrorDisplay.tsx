// Error Display Component for gitx terminal UI
// GREEN phase implementation

export interface ErrorDisplayProps {
  error: Error | string
}

export interface ErrorDisplayElement {
  type: 'ErrorDisplay'
  props: ErrorDisplayProps
  message: string
}

export function ErrorDisplay(props: ErrorDisplayProps): ErrorDisplayElement {
  const message = props.error instanceof Error ? props.error.message : props.error
  return {
    type: 'ErrorDisplay',
    props,
    message
  }
}
