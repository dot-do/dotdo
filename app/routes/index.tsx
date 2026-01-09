import { createFileRoute } from '@tanstack/react-router'
import { SiteContent } from '../components/site/SiteContent'
import { LandingLayout } from '../components/site/LandingLayout'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <LandingLayout>
      <SiteContent />
    </LandingLayout>
  )
}

export default LandingPage
