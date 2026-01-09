import type { ReactNode } from 'react'

interface PrimitivePageProps {
  children: ReactNode
}

export function PrimitivePage({ children }: PrimitivePageProps) {
  return (
    <div data-primitive-page="true">
      <header data-primitive-header role="banner">
        <nav role="navigation" aria-label="Main navigation">
          <a href="/" className="logo">.do</a>
          <div className="nav-links">
            <a href="/docs">Docs</a>
            <a href="https://github.com/dot-do/dotdo">GitHub</a>
            <a href="/admin">Dashboard</a>
            <a href="/docs" className="btn btn-primary">Get Started</a>
          </div>
        </nav>
      </header>
      <main data-primitive-content id="main-content" role="main">
        {children}
      </main>
      <footer data-primitive-footer role="contentinfo">
        <div className="brand">.do</div>
        <p><strong>Solo founders</strong> — Get a team without hiring one.</p>
        <p><strong>Small teams</strong> — AI does the work, humans decide.</p>
        <p><strong>Growing startups</strong> — Add humans without changing code.</p>
        <div className="links">
          <a href="https://platform.do">platform.do</a> ·
          <a href="https://agents.do">agents.do</a> ·
          <a href="https://workers.do">workers.do</a>
        </div>
        <p>MIT License</p>
      </footer>
    </div>
  )
}
