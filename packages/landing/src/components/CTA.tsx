import type { ReactNode } from 'react'

interface CTAProps {
  primary: string
  secondary?: string
  children: ReactNode
}

export function CTA({ primary, secondary, children }: CTAProps) {
  return (
    <div 
      data-component="CTA"
      style={{
        background: '#2563eb',
        color: '#fff',
        textAlign: 'center',
        borderRadius: '1rem',
        padding: '3rem',
      }}
    >
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <a 
          href={primary} 
          data-cta-primary
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            fontWeight: 500,
            background: '#fff',
            color: '#2563eb',
            textDecoration: 'none',
          }}
        >
          {children}
        </a>
        {secondary && (
          <a 
            href={secondary}
            data-cta-secondary
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              fontWeight: 500,
              border: '2px solid #fff',
              background: 'transparent',
              color: '#fff',
              textDecoration: 'none',
            }}
          >
            Star on GitHub
          </a>
        )}
      </div>
    </div>
  )
}
