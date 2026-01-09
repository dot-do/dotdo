/**
 * Landing Page Content Component
 *
 * TSX version of Site.mdx content
 */

import { AgentGrid, Agent, FeatureGrid, Feature, CTA, CodeBlock } from '.'

export function SiteContent() {
  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="text-center space-y-6">
        <h1 className="text-5xl font-bold">Build your 1-Person Unicorn.</h1>
        <p className="text-xl text-muted-foreground">
          Deploy a startup with product, engineering, marketing, and sales.
          <br />
          It's Tuesday. You're one person.
        </p>
        <CodeBlock language="typescript">{`import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = await priya\`define the MVP for \${this.hypothesis}\`
    const app = await ralph\`build \${spec}\`
    const reviewed = await tom\`ship \${app}\`

    await mark\`announce the launch\`
    await sally\`start selling\`

    // Your business is running. Go back to bed.
  }
}`}</CodeBlock>
      </section>

      {/* How It Works */}
      <section className="space-y-6">
        <h2 className="text-3xl font-bold">How This Actually Works</h2>
        <p>
          Built on{' '}
          <a
            href="https://github.com/cloudflare/capnweb"
            className="text-blue-600 hover:underline"
          >
            Cap'n Web
          </a>
          —object-capability RPC with promise pipelining.
        </p>
        <CodeBlock language="typescript">{`// This runs as a single batch, not N separate calls
const sprint = await priya\`plan the sprint\`
  .map(issue => ralph\`build \${issue}\`)
  .map(code => tom\`review \${code}\`)`}</CodeBlock>
        <p className="text-muted-foreground">
          The <code>.map()</code> isn't JavaScript's array method. It's a{' '}
          <strong>Magic Map</strong> that records your callback, sends it to the
          server, and replays it for each result. All in one network round trip.
        </p>
      </section>

      {/* Meet Your Team */}
      <section className="space-y-6">
        <h2 className="text-3xl font-bold">Meet Your Team</h2>
        <AgentGrid>
          <Agent name="Priya" role="Product" avatar="P">
            specs, roadmaps, priorities
          </Agent>
          <Agent name="Ralph" role="Engineering" avatar="R">
            builds what you need
          </Agent>
          <Agent name="Tom" role="Tech Lead" avatar="T">
            architecture, code review
          </Agent>
          <Agent name="Rae" role="Frontend" avatar="R">
            React, UI, accessibility
          </Agent>
          <Agent name="Mark" role="Marketing" avatar="M">
            copy, content, launches
          </Agent>
          <Agent name="Sally" role="Sales" avatar="S">
            outreach, demos, closing
          </Agent>
          <Agent name="Quinn" role="QA" avatar="Q">
            testing, edge cases, quality
          </Agent>
        </AgentGrid>
        <p className="text-muted-foreground">
          Each agent has real identity—email, GitHub account, avatar. When Tom
          reviews your PR, you see <code>@tom-do</code> commenting. They're not
          chatbots. They're workers.
        </p>
      </section>

      {/* The $ Context */}
      <section className="space-y-6">
        <h2 className="text-3xl font-bold">The $ Context</h2>
        <p>
          Every Durable Object has a workflow context that handles execution,
          events, and scheduling. No boilerplate. Infinite combinations.
        </p>
        <CodeBlock language="typescript">{`// Three durability levels
$.send(event)              // Fire-and-forget
$.try(action)              // Single attempt
$.do(action)               // Durable with retries

// Event handlers via proxy
$.on.Customer.signup(handler)
$.on.Payment.failed(handler)

// Scheduling
$.every.monday.at('9am')(handler)`}</CodeBlock>
      </section>

      {/* Why We Rebuilt Everything */}
      <section className="space-y-6">
        <h2 className="text-3xl font-bold">Why We Rebuilt Everything</h2>
        <p>
          Traditional infrastructure crumbles under 10,000 parallel AI agents.
          We rebuilt on V8 isolates—virtual Chrome tabs with durable state,
          running on the edge.
        </p>
        <FeatureGrid>
          <Feature icon="⚡" title="Promise Pipelining">
            Multiple agent calls execute in one network round trip. The server
            receives your entire pipeline and runs it in a single pass.
          </Feature>
          <Feature icon="🗺️" title="Magic Map">
            The .map() isn't JavaScript's array method. It records your
            callback, sends it to the server, and replays it for each result.
          </Feature>
          <Feature icon="🌐" title="V8 Isolates">
            Virtual Chrome tabs with persistent state. 0ms cold starts. Runs in
            300+ cities worldwide.
          </Feature>
          <Feature icon="🔌" title="38 Compat SDKs">
            Use APIs you know—Supabase, MongoDB, Kafka, Redis. Same code, scales
            to millions of agents.
          </Feature>
          <Feature icon="🧱" title="Extended Primitives">
            fsx (filesystem), gitx (version control), bashx (shell)—all rebuilt
            for edge without VMs.
          </Feature>
          <Feature icon="👤" title="Human Escalation">
            AI does the work. Humans make decisions. Route to Slack, email, SMS
            with full audit trail.
          </Feature>
        </FeatureGrid>
      </section>

      {/* Pricing */}
      <section className="space-y-6">
        <h2 className="text-3xl font-bold">$0 Egress. Forever.</h2>
        <p>
          Built on Cloudflare R2. No transfer fees. Your data warehouse runs at
          a fraction of legacy costs.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Service</th>
                <th className="border p-2 text-left">Egress</th>
                <th className="border p-2 text-left">Storage</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2 font-semibold">Cloudflare R2</td>
                <td className="border p-2 font-semibold text-green-600">$0</td>
                <td className="border p-2">$0.015/GB-mo</td>
              </tr>
              <tr>
                <td className="border p-2">AWS S3</td>
                <td className="border p-2">$0.09/GB</td>
                <td className="border p-2">$0.023/GB-mo</td>
              </tr>
              <tr>
                <td className="border p-2">Snowflake</td>
                <td className="border p-2">$0.05-0.12/GB</td>
                <td className="border p-2">Credit-based</td>
              </tr>
              <tr>
                <td className="border p-2">BigQuery</td>
                <td className="border p-2">$0.05-0.12/GB</td>
                <td className="border p-2">$0.02/GB-mo</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center space-y-6">
        <h2 className="text-3xl font-bold">
          Ready to build your 1-Person Unicorn?
        </h2>
        <p className="text-xl text-muted-foreground">
          Solo founders get a team. Small teams scale. AI does the work. Humans
          decide.
        </p>
        <CTA primary="/docs" secondary="https://github.com/dot-do/dotdo">
          Get Started
        </CTA>
      </section>

      {/* Footer */}
      <section className="text-center space-y-4 border-t pt-8">
        <p>
          <strong>Solo founders</strong> — Get a team without hiring one.
        </p>
        <p>
          <strong>Small teams</strong> — AI does the work, humans decide.
        </p>
        <p>
          <strong>Growing startups</strong> — Add humans without changing code.
        </p>
        <div className="flex justify-center gap-4 text-sm text-muted-foreground">
          <a href="https://platform.do" className="hover:underline">
            platform.do
          </a>
          <span>·</span>
          <a href="https://agents.do" className="hover:underline">
            agents.do
          </a>
          <span>·</span>
          <a href="https://workers.do" className="hover:underline">
            workers.do
          </a>
        </div>
      </section>
    </div>
  )
}
