// Scrollable Content Component for gitx terminal UI
// GREEN phase implementation

export interface ScrollableContentProps {
  content: string
  height: number
  onScroll?: (scrollPosition: number) => void
}

export interface ScrollableContentElement {
  type: 'ScrollableContent'
  props: ScrollableContentProps
  content: string
  height: number
}

export function ScrollableContent(props: ScrollableContentProps): ScrollableContentElement {
  return {
    type: 'ScrollableContent',
    props,
    content: props.content,
    height: props.height
  }
}
