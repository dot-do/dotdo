import { createFileRoute } from '@tanstack/react-router'
import Site from '../../Site.mdx'
import { LandingLayout } from '../components/site/LandingLayout'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <LandingLayout>
      <Site />
    </LandingLayout>
  )
}

export default LandingPage
