export { PrimitivePage } from './components/PrimitivePage'
export { AgentGrid } from './components/AgentGrid'
export { Agent } from './components/Agent'
export { FeatureGrid } from './components/FeatureGrid'
export { Feature } from './components/Feature'
export { CTA } from './components/CTA'

// MDX components map for provider
export const mdxComponents = {
  AgentGrid: async () => (await import('./components/AgentGrid')).AgentGrid,
  Agent: async () => (await import('./components/Agent')).Agent,
  FeatureGrid: async () => (await import('./components/FeatureGrid')).FeatureGrid,
  Feature: async () => (await import('./components/Feature')).Feature,
  CTA: async () => (await import('./components/CTA')).CTA,
}
