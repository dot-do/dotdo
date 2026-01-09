import type { ReactNode } from 'react'

interface AgentProps {
  name: string
  role: string
  avatar: string
  children: ReactNode
}

export function Agent({ name, role, avatar, children }: AgentProps) {
  return (
    <div 
      data-component="Agent" 
      data-agent-name={name}
      style={{
        background: '#f9fafb',
        padding: '1.5rem',
        borderRadius: '0.75rem',
        textAlign: 'center',
      }}
    >
      <div 
        data-agent-avatar
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          background: '#e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1rem',
          fontSize: '1.5rem',
          fontWeight: 'bold',
        }}
      >
        {avatar}
      </div>
      <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{name}</h3>
      <div style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{role}</div>
      <p>{children}</p>
    </div>
  )
}
