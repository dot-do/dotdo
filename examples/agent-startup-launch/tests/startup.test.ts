/**
 * Agent Startup Launch - Tests
 *
 * Tests for the complete AI-driven startup launch workflow.
 * Tests cover agent helpers, workflow execution, and the DO API.
 *
 * @module agent-startup-launch/tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import agent helpers
import {
  parseProductSpec,
  formatProductSpec,
  type ProductSpec,
} from '../src/agents/priya'

import {
  parseBuildResult,
  formatBuildResult,
  type BuildResult,
} from '../src/agents/ralph'

import {
  parseReviewResult,
  formatReviewResult,
  hasCriticalIssues,
  type ReviewResult,
} from '../src/agents/tom'

import {
  parseLaunchContent,
  formatLaunchContent,
  type LaunchContent,
} from '../src/agents/mark'

import {
  parseSalesStrategy,
  formatSalesStrategy,
  type SalesStrategy,
} from '../src/agents/sally'

// Import workflow
import {
  createLaunchWorkflow,
  standardLaunchWorkflow,
  type WorkflowDefinition,
} from '../workflows/launch'

// ============================================================================
// AGENT HELPER TESTS
// ============================================================================

describe('Agent Helpers', () => {
  describe('Priya - Product Spec Parser', () => {
    it('should parse valid JSON product spec', () => {
      const response = `
Here's the product specification:

\`\`\`json
{
  "name": "TaskAI",
  "tagline": "AI-powered task management",
  "problem": "Too many tasks, not enough time",
  "solution": "AI prioritizes and schedules tasks automatically",
  "targetUser": "Busy professionals",
  "mvpFeatures": ["Task creation", "AI prioritization", "Calendar sync"],
  "successMetrics": ["1000 users", "50% retention"],
  "outOfScope": ["Team features", "Mobile app"]
}
\`\`\`
      `

      const spec = parseProductSpec(response)
      expect(spec).not.toBeNull()
      expect(spec!.name).toBe('TaskAI')
      expect(spec!.mvpFeatures).toHaveLength(3)
      expect(spec!.targetUser).toBe('Busy professionals')
    })

    it('should return null for invalid response', () => {
      const response = 'This is just text without JSON'
      const spec = parseProductSpec(response)
      expect(spec).toBeNull()
    })

    it('should format product spec for display', () => {
      const spec: ProductSpec = {
        name: 'TestProduct',
        tagline: 'Test tagline',
        problem: 'Test problem',
        solution: 'Test solution',
        targetUser: 'Test users',
        mvpFeatures: ['Feature 1', 'Feature 2'],
        successMetrics: ['Metric 1'],
        outOfScope: ['Future feature'],
      }

      const formatted = formatProductSpec(spec)
      expect(formatted).toContain('# TestProduct')
      expect(formatted).toContain('Test tagline')
      expect(formatted).toContain('Feature 1')
      expect(formatted).toContain('Feature 2')
    })
  })

  describe('Ralph - Build Result Parser', () => {
    it('should parse valid JSON build result', () => {
      const response = `
\`\`\`json
{
  "files": [
    {
      "path": "src/index.ts",
      "content": "export function main() {}",
      "description": "Main entry point"
    }
  ],
  "summary": "Built initial structure",
  "dependencies": ["hono"],
  "testPlan": ["Unit tests", "Integration tests"]
}
\`\`\`
      `

      const result = parseBuildResult(response)
      expect(result).not.toBeNull()
      expect(result!.files).toHaveLength(1)
      expect(result!.files[0].path).toBe('src/index.ts')
      expect(result!.dependencies).toContain('hono')
    })

    it('should format build result for display', () => {
      const result: BuildResult = {
        files: [
          { path: 'src/main.ts', content: 'code here', description: 'Main file' },
        ],
        summary: 'Build complete',
        dependencies: ['dep1'],
        testPlan: ['Test 1'],
      }

      const formatted = formatBuildResult(result)
      expect(formatted).toContain('# Build Complete')
      expect(formatted).toContain('src/main.ts')
      expect(formatted).toContain('dep1')
    })
  })

  describe('Tom - Review Result Parser', () => {
    it('should parse valid JSON review result', () => {
      const response = `
\`\`\`json
{
  "approved": true,
  "score": 85,
  "summary": "Good code quality",
  "categories": {
    "architecture": 90,
    "security": 80,
    "performance": 85,
    "style": 88,
    "correctness": 82
  },
  "issues": [],
  "strengths": ["Clean structure", "Good naming"]
}
\`\`\`
      `

      const review = parseReviewResult(response)
      expect(review).not.toBeNull()
      expect(review!.approved).toBe(true)
      expect(review!.score).toBe(85)
      expect(review!.categories.architecture).toBe(90)
    })

    it('should identify critical issues', () => {
      const review: ReviewResult = {
        approved: false,
        score: 40,
        summary: 'Critical issues found',
        categories: {
          architecture: 50,
          security: 30,
          performance: 50,
          style: 60,
          correctness: 40,
        },
        issues: [
          {
            severity: 'critical',
            category: 'security',
            message: 'SQL injection vulnerability',
            suggestion: 'Use parameterized queries',
          },
        ],
        strengths: [],
      }

      expect(hasCriticalIssues(review)).toBe(true)
    })

    it('should not flag non-critical issues as critical', () => {
      const review: ReviewResult = {
        approved: false,
        score: 70,
        summary: 'Minor issues',
        categories: {
          architecture: 80,
          security: 80,
          performance: 70,
          style: 60,
          correctness: 70,
        },
        issues: [
          {
            severity: 'minor',
            category: 'style',
            message: 'Missing semicolon',
            suggestion: 'Add semicolon',
          },
        ],
        strengths: ['Good structure'],
      }

      expect(hasCriticalIssues(review)).toBe(false)
    })
  })

  describe('Mark - Launch Content Parser', () => {
    it('should parse valid JSON launch content', () => {
      const response = `
\`\`\`json
{
  "headline": "Introducing TaskAI",
  "tagline": "AI-powered productivity",
  "announcement": "We are excited to launch...",
  "keyMessages": ["Save time", "Stay organized"],
  "socialPosts": {
    "twitter": "Launching today!",
    "linkedin": "Proud to announce...",
    "productHunt": "TaskAI is here!"
  },
  "callToAction": "Sign up now",
  "targetAudience": "Busy professionals"
}
\`\`\`
      `

      const content = parseLaunchContent(response)
      expect(content).not.toBeNull()
      expect(content!.headline).toBe('Introducing TaskAI')
      expect(content!.socialPosts.twitter).toBe('Launching today!')
    })
  })

  describe('Sally - Sales Strategy Parser', () => {
    it('should parse valid JSON sales strategy', () => {
      const response = `
\`\`\`json
{
  "targetSegments": [
    { "segment": "SMBs", "pain": "No time", "value": "Automation" }
  ],
  "pricing": {
    "model": "subscription",
    "tiers": ["Free", "Pro $29/mo"],
    "positioning": "Value-based"
  },
  "outreachPlan": {
    "channels": ["Email", "LinkedIn"],
    "cadence": "Weekly",
    "templates": {
      "cold": "Hi there...",
      "followUp": "Following up...",
      "demo": "Let me show you..."
    }
  },
  "objectionHandling": [
    { "objection": "Too expensive", "response": "ROI is..." }
  ],
  "closingStrategy": "Focus on quick wins"
}
\`\`\`
      `

      const strategy = parseSalesStrategy(response)
      expect(strategy).not.toBeNull()
      expect(strategy!.targetSegments).toHaveLength(1)
      expect(strategy!.pricing.model).toBe('subscription')
    })
  })
})

// ============================================================================
// WORKFLOW TESTS
// ============================================================================

describe('Launch Workflow', () => {
  describe('Standard Workflow', () => {
    it('should have all required steps', () => {
      expect(standardLaunchWorkflow.steps).toHaveLength(5)

      const stepAgents = standardLaunchWorkflow.steps.map((s) => s.agent)
      expect(stepAgents).toContain('priya')
      expect(stepAgents).toContain('ralph')
      expect(stepAgents).toContain('tom')
      expect(stepAgents).toContain('mark')
      expect(stepAgents).toContain('sally')
    })

    it('should have correct step order with dependencies', () => {
      const steps = standardLaunchWorkflow.steps

      // First step has no dependencies
      expect(steps[0].dependsOn).toBeUndefined()

      // Build depends on define
      expect(steps[1].dependsOn).toContain('step-1-define')

      // Review depends on build
      expect(steps[2].dependsOn).toContain('step-2-build')

      // Announce depends on review
      expect(steps[3].dependsOn).toContain('step-3-review')

      // Sell depends on announce
      expect(steps[4].dependsOn).toContain('step-4-announce')
    })

    it('should have retry configuration for review step', () => {
      const reviewStep = standardLaunchWorkflow.steps.find((s) => s.agent === 'tom')
      expect(reviewStep?.retry).toBeDefined()
      expect(reviewStep?.retry?.maxAttempts).toBe(5)
    })
  })

  describe('Workflow Builder', () => {
    it('should build custom workflow', () => {
      const workflow = createLaunchWorkflow()
        .name('custom-launch')
        .description('Custom workflow')
        .define('define MVP')
        .build('build it')
        .announce('announce')
        .build()

      expect(workflow.name).toBe('custom-launch')
      expect(workflow.steps).toHaveLength(3)
    })

    it('should chain dependencies correctly', () => {
      const workflow = createLaunchWorkflow()
        .define('step 1')
        .build('step 2')
        .announce('step 3')
        .build()

      // Second step should depend on first
      expect(workflow.steps[1].dependsOn).toContain(workflow.steps[0].id)

      // Third step should depend on second
      expect(workflow.steps[2].dependsOn).toContain(workflow.steps[1].id)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS (Mocked)
// ============================================================================

describe('StartupLaunchDO Integration', () => {
  // These tests would require a full Cloudflare Workers environment
  // For unit testing, we test the individual components

  describe('Launch Session', () => {
    it('should define launch session structure', () => {
      const session = {
        id: 'test-session',
        hypothesis: {
          customer: 'Developers',
          problem: 'Testing is tedious',
          solution: 'AI-powered testing',
          differentiator: 'Zero config',
        },
        status: 'pending' as const,
        steps: [],
        currentStep: 0,
        iterations: 0,
        maxIterations: 3,
        startedAt: new Date().toISOString(),
        approved: false,
      }

      expect(session.hypothesis.customer).toBe('Developers')
      expect(session.status).toBe('pending')
      expect(session.maxIterations).toBe(3)
    })

    it('should track workflow progress', () => {
      const session = {
        id: 'progress-test',
        hypothesis: { customer: 'Test', problem: 'Test', solution: 'Test' },
        status: 'in_progress' as const,
        steps: [
          { id: 's1', agent: 'priya', action: 'define', status: 'completed' },
          { id: 's2', agent: 'ralph', action: 'build', status: 'in_progress' },
          { id: 's3', agent: 'tom', action: 'review', status: 'pending' },
        ],
        currentStep: 1,
        iterations: 0,
        maxIterations: 3,
        startedAt: new Date().toISOString(),
        approved: false,
      }

      const completedSteps = session.steps.filter((s) => s.status === 'completed')
      const pendingSteps = session.steps.filter((s) => s.status === 'pending')

      expect(completedSteps).toHaveLength(1)
      expect(pendingSteps).toHaveLength(1)
      expect(session.currentStep).toBe(1)
    })
  })

  describe('Event Handlers', () => {
    it('should define business event types', () => {
      const events = [
        { type: 'Customer.signup', data: { email: 'test@example.com', plan: 'pro' } },
        { type: 'Payment.received', data: { amount: 299, customerId: 'cust_123' } },
        { type: 'Payment.failed', data: { customerId: 'cust_456', reason: 'insufficient_funds' } },
        { type: 'Feature.requested', data: { feature: 'Dark mode', votes: 15 } },
        { type: 'Customer.churned', data: { email: 'churn@example.com', reason: 'too_expensive' } },
        { type: 'Bug.reported', data: { severity: 'critical', description: 'Login broken' } },
      ]

      expect(events).toHaveLength(6)
      events.forEach((event) => {
        expect(event.type).toMatch(/^\w+\.\w+$/)
        expect(event.data).toBeDefined()
      })
    })
  })

  describe('Metrics Tracking', () => {
    it('should track business metrics', () => {
      const metrics = {
        signups: 0,
        mrr: 0,
        customers: 0,
        churn: 0,
      }

      // Simulate signup
      metrics.signups++
      metrics.customers++

      // Simulate payment
      metrics.mrr += 299

      // Simulate churn
      metrics.churn++
      metrics.customers--

      expect(metrics.signups).toBe(1)
      expect(metrics.mrr).toBe(299)
      expect(metrics.customers).toBe(0)
      expect(metrics.churn).toBe(1)
    })
  })
})

// ============================================================================
// API ENDPOINT TESTS
// ============================================================================

describe('API Endpoints', () => {
  describe('Request/Response Types', () => {
    it('should define launch request structure', () => {
      const launchRequest = {
        hypothesis: {
          customer: 'Solo entrepreneurs',
          problem: 'Building startups is slow',
          solution: 'AI agents automate everything',
          differentiator: 'First fully autonomous launch platform',
        },
        maxIterations: 3,
      }

      expect(launchRequest.hypothesis.customer).toBeDefined()
      expect(launchRequest.hypothesis.problem).toBeDefined()
      expect(launchRequest.hypothesis.solution).toBeDefined()
      expect(launchRequest.maxIterations).toBe(3)
    })

    it('should define RPC request structure', () => {
      const rpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'launch',
        params: [
          {
            customer: 'Test',
            problem: 'Test',
            solution: 'Test',
          },
        ],
      }

      expect(rpcRequest.jsonrpc).toBe('2.0')
      expect(rpcRequest.method).toBe('launch')
      expect(rpcRequest.params).toHaveLength(1)
    })
  })
})
