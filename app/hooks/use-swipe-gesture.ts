/**
 * useSwipeGesture Hook
 *
 * Detects swipe gestures on touch devices.
 * Useful for mobile drawer open/close interactions.
 *
 * @example
 * ```tsx
 * import { useSwipeGesture } from '~/hooks/use-swipe-gesture'
 *
 * function MobileDrawer({ isOpen, onClose, onOpen }) {
 *   const swipeHandlers = useSwipeGesture({
 *     onSwipeLeft: onClose,
 *     onSwipeRight: onOpen,
 *   })
 *
 *   return (
 *     <div {...swipeHandlers}>
 *       <DrawerContent />
 *     </div>
 *   )
 * }
 * ```
 */

import { useCallback, useRef } from 'react'
import type { TouchEvent } from 'react'

export interface SwipeGestureOptions {
  /** Callback when user swipes left */
  onSwipeLeft?: () => void
  /** Callback when user swipes right */
  onSwipeRight?: () => void
  /** Callback when user swipes up */
  onSwipeUp?: () => void
  /** Callback when user swipes down */
  onSwipeDown?: () => void
  /** Minimum distance to trigger swipe (default: 50px) */
  threshold?: number
  /** Maximum vertical movement allowed for horizontal swipe (default: 100px) */
  tolerance?: number
}

export interface SwipeGestureHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
}

interface TouchPosition {
  x: number
  y: number
}

/**
 * Hook that returns touch event handlers for swipe gesture detection
 */
export function useSwipeGesture(options: SwipeGestureOptions): SwipeGestureHandlers {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    tolerance = 100,
  } = options

  const startPosition = useRef<TouchPosition | null>(null)
  const currentPosition = useRef<TouchPosition | null>(null)

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0]
    if (touch) {
      startPosition.current = { x: touch.clientX, y: touch.clientY }
      currentPosition.current = { x: touch.clientX, y: touch.clientY }
    }
  }, [])

  const onTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0]
    if (touch) {
      currentPosition.current = { x: touch.clientX, y: touch.clientY }
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    if (!startPosition.current || !currentPosition.current) {
      return
    }

    const deltaX = currentPosition.current.x - startPosition.current.x
    const deltaY = currentPosition.current.y - startPosition.current.y
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    // Determine if this is a horizontal or vertical swipe
    if (absDeltaX > absDeltaY) {
      // Horizontal swipe
      if (absDeltaX >= threshold && absDeltaY <= tolerance) {
        if (deltaX > 0) {
          onSwipeRight?.()
        } else {
          onSwipeLeft?.()
        }
      }
    } else {
      // Vertical swipe
      if (absDeltaY >= threshold && absDeltaX <= tolerance) {
        if (deltaY > 0) {
          onSwipeDown?.()
        } else {
          onSwipeUp?.()
        }
      }
    }

    // Reset
    startPosition.current = null
    currentPosition.current = null
  }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, tolerance])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  }
}
