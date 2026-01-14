// Navigation List Component for gitx terminal UI
// GREEN phase implementation

export interface NavigationListProps {
  items: string[]
  selectedIndex: number
  onSelect: (index: number) => void
  onNavigate: (direction: 'up' | 'down') => void
}

export interface NavigationListElement {
  type: 'NavigationList'
  props: NavigationListProps
  items: string[]
  selectedIndex: number
}

export function NavigationList(props: NavigationListProps): NavigationListElement {
  return {
    type: 'NavigationList',
    props,
    items: props.items,
    selectedIndex: props.selectedIndex
  }
}
