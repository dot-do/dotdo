import { createFileRoute } from '@tanstack/react-router'
import React from 'react'
import { LandingLayout } from '../components/site/LandingLayout'
import { SiteContent } from '../components/site/SiteContent'

export const Route = createFileRoute('/')({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: 'dotdo - Build your 1-Person Unicorn' },
      { name: 'description', content: 'Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents.' },
      { property: 'og:title', content: 'dotdo - Build your 1-Person Unicorn' },
      { property: 'og:description', content: 'Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents.' },
      { property: 'og:type', content: 'website' },
    ],
  }),
})

function LandingPage() {
  return (
    <LandingLayout>
      <SiteContent />
    </LandingLayout>
  )
}

export default LandingPage
