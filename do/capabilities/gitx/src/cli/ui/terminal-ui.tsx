// Terminal UI for gitx CLI using @opentui/react
// GREEN phase implementation - minimum code to pass tests

// ============================================================================
// Types
// ============================================================================

export interface TerminalUIProps {
  children?: unknown
}

export interface KeyboardEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

export interface MouseEvent {
  x: number
  y: number
  button: 'left' | 'right' | 'middle'
}

export interface TerminalDimensions {
  width: number
  height: number
}

export interface DiffViewProps {
  diff: string
  viewMode: 'split' | 'unified'
}

export interface LoadingSpinnerProps {
  message?: string
}

export interface ErrorDisplayProps {
  error: Error | string
}

export interface ScrollableContentProps {
  content: string
  height: number
}

export interface FuzzySearchProps {
  items: string[]
  onSelect: (item: string) => void
  onCancel: () => void
}

// Element types for custom terminal UI components
export interface TerminalUIAppElement {
  type: 'TerminalUIApp'
  props: TerminalUIProps
  children?: unknown
}

export interface DiffViewElement {
  type: 'DiffView'
  props: DiffViewProps
  diff: string
  viewMode: 'split' | 'unified'
}

export interface LoadingSpinnerElement {
  type: 'LoadingSpinner'
  props: LoadingSpinnerProps
  message?: string
}

export interface ErrorDisplayElement {
  type: 'ErrorDisplay'
  props: ErrorDisplayProps
  message: string
}

export interface ScrollableContentElement {
  type: 'ScrollableContent'
  props: ScrollableContentProps
  content: string
  height: number
}

export interface FuzzySearchElement {
  type: 'FuzzySearch'
  props: FuzzySearchProps
  items: string[]
  onSelect: (item: string) => void
  onCancel: () => void
}

// ============================================================================
// Terminal UI App Component
// ============================================================================

export function TerminalUIApp(props: TerminalUIProps): TerminalUIAppElement {
  // Returns a simple representation of the app
  return {
    type: 'TerminalUIApp',
    props,
    children: props.children
  }
}

// ============================================================================
// Keyboard Input Handler
// ============================================================================

export function handleKeyboardInput(_event: KeyboardEvent): void {
  // Handles all keyboard events without throwing
  // Arrow keys, Enter, Escape, vim-style navigation, etc.
  // This is a minimal implementation that just accepts all events
}

// ============================================================================
// Mouse Event Handler
// ============================================================================

export function handleMouseClick(_event: MouseEvent): void {
  // Handles all mouse click events without throwing
  // Supports left, right, and middle clicks at any coordinates
}

// ============================================================================
// Terminal Dimensions
// ============================================================================

export function getTerminalDimensions(): TerminalDimensions {
  // Get terminal dimensions from process.stdout or fallback to defaults
  const width = process.stdout?.columns ?? 80
  const height = process.stdout?.rows ?? 24
  return { width, height }
}

export function adaptLayoutForWidth(width: number): 'wide' | 'narrow' {
  // Wide layout for terminals >= 120 columns
  // Narrow layout for terminals < 120 columns
  if (width >= 120) {
    return 'wide'
  }
  return 'narrow'
}

// ============================================================================
// Diff View
// ============================================================================

export function DiffView(props: DiffViewProps): DiffViewElement {
  // Returns a representation of the diff view component
  return {
    type: 'DiffView',
    props,
    diff: props.diff,
    viewMode: props.viewMode
  }
}

export function selectDiffViewMode(terminalWidth: number): 'split' | 'unified' {
  // Wide terminals (>= 120 columns) should use split view
  // Narrow terminals (< 120 columns) should use unified view
  if (terminalWidth >= 120) {
    return 'split'
  }
  return 'unified'
}

// ============================================================================
// Loading Spinner
// ============================================================================

export function LoadingSpinner(props: LoadingSpinnerProps): LoadingSpinnerElement {
  // Returns a representation of the loading spinner component
  return {
    type: 'LoadingSpinner',
    props,
    message: props.message
  }
}

// ============================================================================
// Error Display
// ============================================================================

export function ErrorDisplay(props: ErrorDisplayProps): ErrorDisplayElement {
  // Returns a representation of the error display component
  const message = props.error instanceof Error ? props.error.message : props.error
  return {
    type: 'ErrorDisplay',
    props,
    message
  }
}

// ============================================================================
// Scrollable Content
// ============================================================================

export function ScrollableContent(props: ScrollableContentProps): ScrollableContentElement {
  // Returns a representation of the scrollable content component
  return {
    type: 'ScrollableContent',
    props,
    content: props.content,
    height: props.height
  }
}

// ============================================================================
// Fuzzy Search
// ============================================================================

export function FuzzySearch(props: FuzzySearchProps): FuzzySearchElement {
  // Returns a representation of the fuzzy search component
  return {
    type: 'FuzzySearch',
    props,
    items: props.items,
    onSelect: props.onSelect,
    onCancel: props.onCancel
  }
}

// ============================================================================
// Render Function
// ============================================================================

export function render(_element: unknown): void {
  // Minimal render function that accepts any element
  // In a real implementation, this would render to the terminal
}
