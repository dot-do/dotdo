/**
 * Site marketing page component for gitx.do
 *
 * Marketing landing page using @mdxui/beacon:
 * - Hero section with code examples
 * - Feature highlights (Git on edge, no VMs, etc.)
 * - Pricing section
 * - FAQ
 * - Footer with links
 */

import { LandingPage } from '@mdxui/beacon'
import { SiGithub, SiX } from '@icons-pack/react-simple-icons'

export default function Site() {
  return (
    <LandingPage
      logo={<span className="font-bold text-xl">gitx.do</span>}
      header={{
        links: [
          { label: 'Docs', href: '/docs' },
          { label: 'GitHub', href: 'https://github.com/dot-do/gitx' },
          { label: 'npm', href: 'https://www.npmjs.com/package/gitx.do' },
        ],
        primaryCta: 'Get Started',
      }}
      hero={{
        title: 'Git for',
        highlightedText: 'Cloudflare Workers',
        description: 'AI agents need version control. gitx is Git reimplemented for the edge—full protocol support, pack files, delta compression, smart HTTP. Scales to millions of agents.',
        primaryButtonText: 'npm install gitx.do',
        primaryButtonHref: 'https://www.npmjs.com/package/gitx.do',
        secondaryButtonText: 'View Docs',
        secondaryButtonHref: '/docs',
        showCodeTabs: true,
        codeTabs: [
          {
            name: 'sdk',
            label: 'SDK',
            lang: 'typescript',
            code: `import git from 'gitx.do'

await git.init('/my-project')
await git.add('/my-project', '.')
await git.commit('/my-project', 'Initial commit')

const log = await git.log('/my-project')`,
          },
          {
            name: 'durable-object',
            label: 'Durable Object',
            lang: 'typescript',
            code: `import { withGit } from 'gitx.do/do'
import { DO } from 'dotdo'

class MyAgent extends withGit(DO) {
  async work() {
    await this.$.git.add('.', 'src/')
    await this.$.git.commit('.', 'Update files')
  }
}`,
          },
          {
            name: 'wire-protocol',
            label: 'Wire Protocol',
            lang: 'javascript',
            code: `// Clone works with standard git clients
// git clone https://your-worker.dev/repo.git

// Push and fetch too
// git push origin main
// git fetch origin`,
          },
        ],
      }}
      features={{
        items: [
          {
            iconName: 'GitBranch',
            title: 'Full Git Protocol',
            description: 'Complete implementation—blob, tree, commit, tag. Pack files, delta compression, smart HTTP. Not a wrapper.',
          },
          {
            iconName: 'Layers',
            title: 'Tiered Storage',
            description: 'Hot objects in SQLite for speed. Pack files in R2 for cost. Automatic tier selection.',
          },
          {
            iconName: 'Globe',
            title: 'Edge-Native',
            description: "Runs on Cloudflare's global network. Zero cold starts. Each agent gets isolated version control.",
          },
          {
            iconName: 'GitMerge',
            title: 'Merge & Diff',
            description: 'Full three-way merge with conflict detection. Line-by-line diff. Blame support.',
          },
          {
            iconName: 'Cpu',
            title: 'AI-Native API',
            description: 'MCP tools for AI agents. git_init, git_commit, git_log, git_diff—all exposed for LLMs.',
          },
          {
            iconName: 'Zap',
            title: 'Wire Protocol',
            description: 'Smart HTTP protocol. Clone, fetch, push work with standard git clients. Side-band progress.',
          },
        ],
      }}
      pricing={{
        title: 'Simple Pricing',
        description: 'Self-hosted on your Cloudflare account. Pay only for storage.',
        tiers: [
          {
            name: 'Core Library',
            description: 'Full Git implementation. MIT licensed.',
            monthlyPrice: 0,
            features: [
              'All Git operations',
              'Pack file engine',
              'Merge & diff',
              'MCP tools',
              'MIT License',
            ],
            callToAction: 'npm i gitx.do',
            actions: {
              primary: 'https://www.npmjs.com/package/gitx.do',
            },
          },
          {
            name: 'Self-Hosted',
            description: 'Deploy to your Cloudflare account.',
            monthlyPrice: 0,
            features: [
              'Everything in Core',
              'Durable Object storage',
              'R2 for pack files',
              'Wire protocol server',
              '5,600+ tests',
            ],
            callToAction: 'Deploy Now',
            actions: {
              primary: '/docs/deploy',
            },
            highlighted: true,
          },
        ],
      }}
      faqs={{
        title: 'FAQ',
        description: 'Common questions about gitx.do',
        groups: [
          {
            group: 'General',
            items: [
              {
                id: 'real-git',
                question: 'Is this a real Git implementation?',
                answer: 'Yes. gitx.do is a complete reimplementation of Git in TypeScript for Cloudflare Workers. It handles blob, tree, commit, and tag objects. It reads and writes pack files with delta compression. It speaks the Git Smart HTTP protocol. Standard git clients can clone, fetch, and push.',
              },
              {
                id: 'why-not-github',
                question: 'Why not just use GitHub?',
                answer: "GitHub is great for human developers. But AI agents need millions of isolated repositories with no rate limits. gitx.do gives each agent its own Git on Cloudflare's edge—no shared servers, no API limits, instant access worldwide.",
              },
              {
                id: 'storage',
                question: 'How does storage work?',
                answer: 'Hot objects (recent commits, active branches) live in SQLite for <10ms access. Pack files and large blobs go to R2 for cost efficiency. The system handles tier placement automatically.',
              },
              {
                id: 'private-hosting',
                question: 'Can I use this for private Git hosting?',
                answer: 'Absolutely. Deploy gitx.do to your Cloudflare account and you have a private Git server. R2 has no egress fees, so LFS is much cheaper than GitHub or GitLab.',
              },
            ],
          },
        ],
      }}
      footer={{
        description: 'Git for Cloudflare Workers. Full protocol. Edge-native.',
        companyName: 'dotdo',
        linkGroups: [
          {
            group: 'Resources',
            items: [
              { title: 'Documentation', href: '/docs' },
              { title: 'GitHub', href: 'https://github.com/dot-do/gitx' },
              { title: 'npm', href: 'https://www.npmjs.com/package/gitx.do' },
              { title: 'Changelog', href: '/changelog' },
            ],
          },
          {
            group: 'Platform',
            items: [
              { title: 'platform.do', href: 'https://platform.do' },
              { title: 'agents.do', href: 'https://agents.do' },
              { title: 'workers.do', href: 'https://workers.do' },
              { title: 'fsx.do', href: 'https://fsx.do' },
            ],
          },
        ],
        socialLinks: [
          { name: 'GitHub', href: 'https://github.com/dot-do/gitx', icon: <SiGithub size={20} /> },
          { name: 'X', href: 'https://x.com/dotdo_dev', icon: <SiX size={20} /> },
        ],
      }}
    />
  )
}
