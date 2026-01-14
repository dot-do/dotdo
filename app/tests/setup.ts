/**
 * Test setup for App React component tests
 *
 * This file is loaded before each React test file and sets up
 * the testing environment with jsdom and jest-dom matchers.
 */

import '@testing-library/jest-dom/vitest'

// Mock ResizeObserver for Radix UI components (Checkbox uses @radix-ui/react-use-size)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// Mock Element.scrollIntoView for Radix UI Select component
Element.prototype.scrollIntoView = function () {}

// Mock matchMedia for components that use media queries
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock PointerEvent for Radix UI components
// JSDOM doesn't have PointerEvent, which Radix UI uses
class PointerEventMock extends MouseEvent {
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    Object.defineProperty(this, 'pointerId', { value: params.pointerId ?? 0 })
    Object.defineProperty(this, 'width', { value: params.width ?? 1 })
    Object.defineProperty(this, 'height', { value: params.height ?? 1 })
    Object.defineProperty(this, 'pressure', { value: params.pressure ?? 0 })
    Object.defineProperty(this, 'tangentialPressure', { value: params.tangentialPressure ?? 0 })
    Object.defineProperty(this, 'tiltX', { value: params.tiltX ?? 0 })
    Object.defineProperty(this, 'tiltY', { value: params.tiltY ?? 0 })
    Object.defineProperty(this, 'twist', { value: params.twist ?? 0 })
    Object.defineProperty(this, 'pointerType', { value: params.pointerType ?? 'mouse' })
    Object.defineProperty(this, 'isPrimary', { value: params.isPrimary ?? true })
  }

  getCoalescedEvents() {
    return []
  }

  getPredictedEvents() {
    return []
  }
}
globalThis.PointerEvent = PointerEventMock as unknown as typeof PointerEvent

// Mock pointer capture methods for Radix UI components
HTMLElement.prototype.setPointerCapture = function () {}
HTMLElement.prototype.releasePointerCapture = function () {}
HTMLElement.prototype.hasPointerCapture = function () { return false }
