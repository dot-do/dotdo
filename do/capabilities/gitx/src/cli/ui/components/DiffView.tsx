// Diff View Component for gitx terminal UI
// GREEN phase implementation

export interface DiffViewProps {
  diff: string
  viewMode: 'split' | 'unified'
}

export interface DiffViewElement {
  type: 'DiffView'
  props: DiffViewProps
  diff: string
  viewMode: 'split' | 'unified'
}

export function DiffView(props: DiffViewProps): DiffViewElement {
  return {
    type: 'DiffView',
    props,
    diff: props.diff,
    viewMode: props.viewMode
  }
}
