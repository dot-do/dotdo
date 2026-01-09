import type { ReactNode } from 'react'

interface FeatureProps {
  icon: string
  title: string
  children: ReactNode
}

export function Feature({ icon, title, children }: FeatureProps) {
  return (
    <div 
      data-component="Feature"
      style={{
        background: '#f9fafb',
        padding: '1.5rem',
        borderRadius: '0.75rem',
      }}
    >
      <div data-feature-icon style={{ fontSize: '2rem', marginBottom: '1rem' }}>{icon}</div>
      <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
