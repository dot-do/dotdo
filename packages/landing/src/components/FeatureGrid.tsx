import type { ReactNode } from 'react'

interface FeatureGridProps {
  children: ReactNode
}

export function FeatureGrid({ children }: FeatureGridProps) {
  return (
    <div 
      data-component="FeatureGrid" 
      style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
        gap: '2rem' 
      }}
    >
      {children}
    </div>
  )
}
