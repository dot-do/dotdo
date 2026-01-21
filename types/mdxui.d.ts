/**
 * Type declarations for @mdxui/cockpit module
 *
 * @mdxui/cockpit provides developer dashboard components
 *
 * @module @mdxui/cockpit
 */

declare module '@mdxui/cockpit' {
  import { ReactNode, ComponentType } from 'react'

  export interface DashboardBranding {
    name: string
    logo: ReactNode
  }

  export interface DashboardIdentity {
    clientId: string
    devMode?: boolean
  }

  export interface DashboardRoutes {
    overview?: boolean
    requests?: boolean
    keys?: boolean
    team?: boolean
    billing?: boolean
    settings?: boolean
  }

  export interface DashboardConfig {
    branding: DashboardBranding
    identity: DashboardIdentity
    routes: DashboardRoutes
  }

  export const DeveloperDashboard: ComponentType<{ config?: DashboardConfig }>
}

/**
 * Type declarations for @mdxui/beacon module
 *
 * @mdxui/beacon provides marketing landing page components
 *
 * @module @mdxui/beacon
 */

declare module '@mdxui/beacon' {
  import { ReactNode, ComponentType } from 'react'

  export interface HeaderLink {
    label: string
    href: string
  }

  export interface Header {
    links: HeaderLink[]
    primaryCta?: string
  }

  export interface CodeTab {
    name: string
    label: string
    lang: string
    code: string
  }

  export interface Hero {
    title: string
    highlightedText?: string
    description: string
    primaryButtonText?: string
    primaryButtonHref?: string
    secondaryButtonText?: string
    secondaryButtonHref?: string
    showCodeTabs?: boolean
    codeTabs?: CodeTab[]
  }

  export interface Feature {
    icon?: ReactNode
    title: string
    description: string
  }

  export interface Pricing {
    title?: string
    tiers?: PricingTier[]
  }

  export interface PricingTier {
    name: string
    price: string | number
    description?: string
    features: string[]
    cta?: string
    highlighted?: boolean
  }

  export interface FAQ {
    question: string
    answer: string
  }

  export interface FooterLink {
    label: string
    href: string
  }

  export interface FooterSection {
    title: string
    links: FooterLink[]
  }

  export interface Footer {
    sections?: FooterSection[]
    copyright?: string
    social?: ReactNode[]
  }

  export interface LandingPageProps {
    logo?: ReactNode
    header?: Header
    hero?: Hero
    features?: Feature[]
    pricing?: Pricing
    faqs?: FAQ[]
    footer?: Footer
  }

  export const LandingPage: ComponentType<LandingPageProps>
}

/**
 * Type declarations for @icons-pack/react-simple-icons module
 *
 * @icons-pack/react-simple-icons provides Simple Icons as React components
 *
 * @module @icons-pack/react-simple-icons
 */

declare module '@icons-pack/react-simple-icons' {
  import { ComponentType, SVGProps } from 'react'

  export interface IconProps extends SVGProps<SVGSVGElement> {
    size?: number | string
    color?: string
    title?: string
  }

  // Common icons used in the project
  export const SiGithub: ComponentType<IconProps>
  export const SiX: ComponentType<IconProps>
  export const SiTwitter: ComponentType<IconProps>
  export const SiLinkedin: ComponentType<IconProps>
  export const SiDiscord: ComponentType<IconProps>
  export const SiSlack: ComponentType<IconProps>
  export const SiReact: ComponentType<IconProps>
  export const SiTypescript: ComponentType<IconProps>
  export const SiJavascript: ComponentType<IconProps>
  export const SiNodedotjs: ComponentType<IconProps>
  export const SiCloudflare: ComponentType<IconProps>
  export const SiNpm: ComponentType<IconProps>
}
