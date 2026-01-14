// Loading Spinner Component for gitx terminal UI
// GREEN phase implementation

export interface LoadingSpinnerProps {
  message?: string
}

export interface LoadingSpinnerElement {
  type: 'LoadingSpinner'
  props: LoadingSpinnerProps
  message?: string
}

export function LoadingSpinner(props: LoadingSpinnerProps): LoadingSpinnerElement {
  return {
    type: 'LoadingSpinner',
    props,
    message: props.message
  }
}
