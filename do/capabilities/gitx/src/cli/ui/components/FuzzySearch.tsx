// Fuzzy Search Component for gitx terminal UI
// GREEN phase implementation

export interface FuzzySearchProps {
  items: string[]
  onSelect: (item: string) => void
  onCancel: () => void
  placeholder?: string
}

export interface FuzzySearchElement {
  type: 'FuzzySearch'
  props: FuzzySearchProps
  items: string[]
  onSelect: (item: string) => void
  onCancel: () => void
}

export function FuzzySearch(props: FuzzySearchProps): FuzzySearchElement {
  return {
    type: 'FuzzySearch',
    props,
    items: props.items,
    onSelect: props.onSelect,
    onCancel: props.onCancel
  }
}
