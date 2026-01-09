import type { ReactNode } from 'react'

interface AgentGridProps {
  children: ReactNode
}

export function AgentGrid({ children }: AgentGridProps) {
  return (
    <div 
      data-component="AgentGrid" 
      style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '1.5rem' 
      }}
    >
      {children}
    </div>
  )
}
