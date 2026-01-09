'use client'

import type { FC } from 'react'

export const Logo: FC = () => (
  <svg viewBox="0 0 80 32" fill="currentColor" style={{ height: 24 }}>
    <text x="0" y="24" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="24">.do</text>
  </svg>
)

export const Icon: FC = () => (
  <svg viewBox="0 0 32 32" fill="currentColor" style={{ height: 24, width: 24 }}>
    <circle cx="16" cy="16" r="14" fill="currentColor" />
    <text x="16" y="21" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fontSize="12" fill="white">do</text>
  </svg>
)
