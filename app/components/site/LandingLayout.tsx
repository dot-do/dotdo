import type { ReactNode } from 'react'

interface LandingLayoutProps {
  children: ReactNode
}

export function LandingLayout({ children }: LandingLayoutProps) {
  const currentYear = new Date().getFullYear()

  return (
    <div data-primitive-page="true" className="min-h-screen flex flex-col bg-black text-white dark:bg-black dark:text-white">
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded"
      >
        Skip to main content
      </a>

      {/* Header */}
      <header data-primitive-header className="border-b border-gray-800">
        <nav className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-bold flex items-center gap-2">
            <span className="text-2xl">.do</span>
          </a>
          <div className="hidden md:flex items-center gap-6">
            <a href="/docs" className="text-gray-400 hover:text-white transition">
              Docs
            </a>
            <a
              href="https://github.com/dot-do/dotdo"
              className="text-gray-400 hover:text-white transition"
            >
              GitHub
            </a>
            <a
              href="https://platform.do"
              className="px-4 py-2 bg-white text-black font-medium rounded hover:bg-gray-200 transition"
            >
              Get Started
            </a>
          </div>
        </nav>
      </header>

      {/* Main */}
      <main id="main-content" data-primitive-content className="flex-1">
        <div className="container max-w-6xl mx-auto px-4 py-12 prose prose-invert prose-lg max-w-none">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer data-primitive-footer className="border-t border-gray-800 py-12 px-4">
        <div className="container max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <span className="text-2xl font-bold">.do</span>
              <p className="text-gray-400 mt-4 max-w-md">
                Build your 1-Person Unicorn. Business-as-Code for autonomous businesses run by AI
                agents.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Resources</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <a href="/docs" className="hover:text-white transition">
                    Documentation
                  </a>
                </li>
                <li>
                  <a href="/docs/getting-started" className="hover:text-white transition">
                    Getting Started
                  </a>
                </li>
                <li>
                  <a href="/docs/api" className="hover:text-white transition">
                    API Reference
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Community</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <a href="https://github.com/dot-do/dotdo" className="hover:text-white transition">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href="https://twitter.com/dotdodev" className="hover:text-white transition">
                    Twitter
                  </a>
                </li>
                <li>
                  <a href="https://discord.gg/dotdo" className="hover:text-white transition">
                    Discord
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-gray-500">
            <p>&copy; {currentYear} dotdo. MIT License.</p>
            <div className="flex gap-4">
              <a href="https://platform.do" className="hover:text-white transition">
                platform.do
              </a>
              <a href="https://agents.do" className="hover:text-white transition">
                agents.do
              </a>
              <a href="https://workers.do" className="hover:text-white transition">
                workers.do
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
