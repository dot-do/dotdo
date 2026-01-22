import { Link } from '@tanstack/react-router'

export interface NavLink {
  href: string
  label: string
  external?: boolean | undefined
}

export interface NavProps {
  links?: NavLink[] | undefined
  className?: string | undefined
}

const defaultLinks: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/admin', label: 'Admin' },
]

export function Nav({ links = defaultLinks, className = '' }: NavProps) {
  return (
    <nav className={`flex items-center space-x-6 ${className}`} aria-label="Main navigation">
      {links.map((link) => (
        link.external ? (
          <a
            key={link.href}
            href={link.href}
            className="text-white hover:text-gray-200 transition-colors font-medium"
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ) : (
          <Link
            key={link.href}
            to={link.href}
            className="text-white hover:text-gray-200 transition-colors font-medium"
            activeProps={{
              className: 'text-white font-bold underline underline-offset-4',
            }}
          >
            {link.label}
          </Link>
        )
      ))}
    </nav>
  )
}
