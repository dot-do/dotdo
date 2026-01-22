/**
 * TDD Integration Tests: @dotdo/app with digital-products
 *
 * This test suite defines the expected integration between @dotdo/app
 * and the digital-products package from primitives.
 *
 * Tests are written using TDD approach - failing tests define the spec
 * for what the integration should provide.
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Test Suite: Product Definition Import
 *
 * Verifies that product definition primitives can be imported and used
 */
describe('Digital Products Integration - Product Definition Primitives', () => {
  describe('Product Definition Types', () => {
    it('should import Product type from digital-products', async () => {
      // TDD: Define the expected import
      const { Product } = await import('digital-products')
      expect(Product).toBeDefined()
    })

    it('should import App type from digital-products', async () => {
      // TDD: Define the expected import
      const { App } = await import('digital-products')
      expect(App).toBeDefined()
    })

    it('should import API type from digital-products', async () => {
      // TDD: Define the expected import
      const { API } = await import('digital-products')
      expect(API).toBeDefined()
    })

    it('should import Site type from digital-products', async () => {
      // TDD: Define the expected import
      const { Site } = await import('digital-products')
      expect(Site).toBeDefined()
    })

    it('should import Content builder from digital-products', async () => {
      // TDD: Define the expected import
      const { Content } = await import('digital-products')
      expect(Content).toBeDefined()
    })

    it('should import Data builder from digital-products', async () => {
      // TDD: Define the expected import
      const { Data } = await import('digital-products')
      expect(Data).toBeDefined()
    })
  })

  describe('Product Creation Functions', () => {
    it('should create a product with Product() factory function', async () => {
      const { Product } = await import('digital-products')

      const product = Product({
        id: 'test-product',
        name: 'Test Product',
        description: 'A test product',
        version: '1.0.0',
      })

      expect(product).toBeDefined()
      expect(product.id).toBe('test-product')
      expect(product.name).toBe('Test Product')
      expect(product.description).toBe('A test product')
      expect(product.version).toBe('1.0.0')
    })

    it('should create an app definition with App() factory', async () => {
      const { App } = await import('digital-products')

      const app = App({
        id: 'my-app',
        name: 'My App',
        description: 'A digital app',
        version: '1.0.0',
      })

      expect(app).toBeDefined()
      expect(app.id).toBe('my-app')
      expect(app.name).toBe('My App')
    })

    it('should create an API definition with API() factory', async () => {
      const { API } = await import('digital-products')

      const api = API({
        id: 'my-api',
        name: 'My API',
        description: 'A REST API',
        version: '1.0.0',
      })

      expect(api).toBeDefined()
      expect(api.id).toBe('my-api')
      expect(api.name).toBe('My API')
    })

    it('should create a site definition with Site() factory', async () => {
      const { Site } = await import('digital-products')

      const site = Site({
        id: 'my-site',
        name: 'My Site',
        description: 'A website',
        version: '1.0.0',
      })

      expect(site).toBeDefined()
      expect(site.id).toBe('my-site')
      expect(site.name).toBe('My Site')
    })
  })

  describe('Product Registry', () => {
    it('should import product registry', async () => {
      const { registry } = await import('digital-products')
      expect(registry).toBeDefined()
    })

    it('should register a product in the registry', async () => {
      const { Product, registerProduct, registry } = await import('digital-products')

      const product = Product({
        id: 'registered-product',
        name: 'Registered Product',
        description: 'A registered product',
        version: '1.0.0',
      })

      const registered = registerProduct(product)
      expect(registered).toEqual(product)

      // Registry should contain the product
      expect(registry).toBeDefined()
    })
  })

  describe('Entity Types and Collections', () => {
    it('should export Nouns entity namespace', async () => {
      const { Nouns } = await import('digital-products')
      expect(Nouns).toBeDefined()
    })

    it('should export AllDigitalProductEntities', async () => {
      const { AllDigitalProductEntities } = await import('digital-products')
      expect(AllDigitalProductEntities).toBeDefined()
    })

    it('should export ProductEntities collection', async () => {
      const { ProductEntities } = await import('digital-products')
      expect(ProductEntities).toBeDefined()
    })

    it('should export InterfaceEntities collection', async () => {
      const { InterfaceEntities } = await import('digital-products')
      expect(InterfaceEntities).toBeDefined()
    })

    it('should export ContentEntities collection', async () => {
      const { ContentEntities } = await import('digital-products')
      expect(ContentEntities).toBeDefined()
    })

    it('should export WebEntities collection', async () => {
      const { WebEntities } = await import('digital-products')
      expect(WebEntities).toBeDefined()
    })

    it('should export AIEntities collection', async () => {
      const { AIEntities } = await import('digital-products')
      expect(AIEntities).toBeDefined()
    })

    it('should export LifecycleEntities collection', async () => {
      const { LifecycleEntities } = await import('digital-products')
      expect(LifecycleEntities).toBeDefined()
    })
  })

  describe('Type Validation Functions', () => {
    it('should export isProduct type guard', async () => {
      const { isProduct } = await import('digital-products')
      expect(isProduct).toBeDefined()
      expect(typeof isProduct).toBe('function')
    })

    it('should export isApp type guard', async () => {
      const { isApp } = await import('digital-products')
      expect(isApp).toBeDefined()
      expect(typeof isApp).toBe('function')
    })

    it('should export isAPI type guard', async () => {
      const { isAPI } = await import('digital-products')
      expect(isAPI).toBeDefined()
      expect(typeof isAPI).toBe('function')
    })

    it('should export isSite type guard', async () => {
      const { isSite } = await import('digital-products')
      expect(isSite).toBeDefined()
      expect(typeof isSite).toBe('function')
    })

    it('should validate product with isProduct', async () => {
      const { Product, isProduct } = await import('digital-products')

      const product = Product({
        id: 'test',
        name: 'Test',
        description: 'Test product',
        version: '1.0.0',
      })

      expect(isProduct(product)).toBe(true)
    })
  })

  describe('Zod Schema Exports', () => {
    it('should export ProductSchema', async () => {
      const { ProductSchema } = await import('digital-products')
      expect(ProductSchema).toBeDefined()
    })

    it('should export AppSchema', async () => {
      const { AppSchema } = await import('digital-products')
      expect(AppSchema).toBeDefined()
    })

    it('should export APISchema', async () => {
      const { APISchema } = await import('digital-products')
      expect(APISchema).toBeDefined()
    })

    it('should export SiteSchema', async () => {
      const { SiteSchema } = await import('digital-products')
      expect(SiteSchema).toBeDefined()
    })

    it('should export ServiceSchema', async () => {
      const { ServiceSchema } = await import('digital-products')
      expect(ServiceSchema).toBeDefined()
    })

    it('should validate product data with ProductSchema', async () => {
      const { ProductSchema } = await import('digital-products')

      const validData = {
        $id: 'test-product',
        $type: 'https://schema.org.ai/Product',
        name: 'Test Product',
        description: 'A test product',
        status: 'active',
      }

      const result = ProductSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })
  })

  describe('Builder Classes', () => {
    it('should export AppBuilder (legacy API)', async () => {
      const { AppBuilder } = await import('digital-products')
      expect(AppBuilder).toBeDefined()
    })

    it('should export APIBuilder (legacy API)', async () => {
      const { APIBuilder } = await import('digital-products')
      expect(APIBuilder).toBeDefined()
    })

    it('should export SiteBuilder (legacy API)', async () => {
      const { SiteBuilder } = await import('digital-products')
      expect(SiteBuilder).toBeDefined()
    })

    it('should export ProductBuilder (legacy API)', async () => {
      const { ProductBuilder } = await import('digital-products')
      expect(ProductBuilder).toBeDefined()
    })
  })

  describe('Data Builders', () => {
    it('should export Data builder', async () => {
      const { Data } = await import('digital-products')
      expect(Data).toBeDefined()
    })

    it('should export Dataset builder', async () => {
      const { Dataset } = await import('digital-products')
      expect(Dataset).toBeDefined()
    })

    it('should export Index builder', async () => {
      const { Index } = await import('digital-products')
      expect(Index).toBeDefined()
    })

    it('should export Relationship builder', async () => {
      const { Relationship } = await import('digital-products')
      expect(Relationship).toBeDefined()
    })

    it('should export Validate builder', async () => {
      const { Validate } = await import('digital-products')
      expect(Validate).toBeDefined()
    })
  })

  describe('Content and Workflow Builders', () => {
    it('should export Content builder', async () => {
      const { Content } = await import('digital-products')
      expect(Content).toBeDefined()
    })

    it('should export Workflow builder', async () => {
      const { Workflow } = await import('digital-products')
      expect(Workflow).toBeDefined()
    })
  })

  describe('MCP and SDK Builders', () => {
    it('should export MCP builder', async () => {
      const { MCP } = await import('digital-products')
      expect(MCP).toBeDefined()
    })

    it('should export Tool builder', async () => {
      const { Tool } = await import('digital-products')
      expect(Tool).toBeDefined()
    })

    it('should export Resource builder', async () => {
      const { Resource } = await import('digital-products')
      expect(Resource).toBeDefined()
    })

    it('should export Prompt builder', async () => {
      const { Prompt } = await import('digital-products')
      expect(Prompt).toBeDefined()
    })

    it('should export SDK builder', async () => {
      const { SDK } = await import('digital-products')
      expect(SDK).toBeDefined()
    })

    it('should export Export builder', async () => {
      const { Export } = await import('digital-products')
      expect(Export).toBeDefined()
    })

    it('should export Example builder', async () => {
      const { Example } = await import('digital-products')
      expect(Example).toBeDefined()
    })
  })

  describe('App-Specific Builders', () => {
    it('should export Route builder for apps', async () => {
      const { Route } = await import('digital-products')
      expect(Route).toBeDefined()
    })

    it('should export State builder for app state management', async () => {
      const { State } = await import('digital-products')
      expect(State).toBeDefined()
    })

    it('should export Auth builder for app authentication', async () => {
      const { Auth } = await import('digital-products')
      expect(Auth).toBeDefined()
    })
  })

  describe('API-Specific Builders', () => {
    it('should export Endpoint builder for APIs', async () => {
      const { Endpoint } = await import('digital-products')
      expect(Endpoint).toBeDefined()
    })

    it('should export APIAuth builder for API authentication', async () => {
      const { APIAuth } = await import('digital-products')
      expect(APIAuth).toBeDefined()
    })

    it('should export RateLimit builder for API rate limiting', async () => {
      const { RateLimit } = await import('digital-products')
      expect(RateLimit).toBeDefined()
    })
  })

  describe('Site-Specific Builders', () => {
    it('should export Nav builder for site navigation', async () => {
      const { Nav } = await import('digital-products')
      expect(Nav).toBeDefined()
    })

    it('should export SEO builder for site SEO', async () => {
      const { SEO } = await import('digital-products')
      expect(SEO).toBeDefined()
    })

    it('should export Analytics builder for site analytics', async () => {
      const { Analytics } = await import('digital-products')
      expect(Analytics).toBeDefined()
    })
  })

  describe('MCP-Specific Builders', () => {
    it('should export MCPConfig builder', async () => {
      const { MCPConfig } = await import('digital-products')
      expect(MCPConfig).toBeDefined()
    })
  })

  describe('Category Collections', () => {
    it('should export ProductCategories', async () => {
      const { ProductCategories } = await import('digital-products')
      expect(ProductCategories).toBeDefined()
    })

    it('should export InterfaceCategories', async () => {
      const { InterfaceCategories } = await import('digital-products')
      expect(InterfaceCategories).toBeDefined()
    })

    it('should export ContentCategories', async () => {
      const { ContentCategories } = await import('digital-products')
      expect(ContentCategories).toBeDefined()
    })

    it('should export WebCategories', async () => {
      const { WebCategories } = await import('digital-products')
      expect(WebCategories).toBeDefined()
    })

    it('should export AICategories', async () => {
      const { AICategories } = await import('digital-products')
      expect(AICategories).toBeDefined()
    })

    it('should export LifecycleCategories', async () => {
      const { LifecycleCategories } = await import('digital-products')
      expect(LifecycleCategories).toBeDefined()
    })

    it('should export DigitalProductEntityCategories', async () => {
      const { DigitalProductEntityCategories } = await import('digital-products')
      expect(DigitalProductEntityCategories).toBeDefined()
    })
  })

  describe('Entities Collection', () => {
    it('should export Entities collection', async () => {
      const { Entities } = await import('digital-products')
      expect(Entities).toBeDefined()
    })
  })

  describe('Legacy Compatibility', () => {
    it('should support createProductDefinition for backwards compatibility', async () => {
      const { createProductDefinition } = await import('digital-products')
      expect(createProductDefinition).toBeDefined()
      expect(typeof createProductDefinition).toBe('function')
    })
  })
})

/**
 * Test Suite: Product Definition Usage in App Components
 *
 * Verifies that product definitions can be used to configure app behavior
 */
describe('Digital Products Integration - App Configuration', () => {
  describe('Using Product Definitions in App Setup', () => {
    it('should define a product and use it to configure app', async () => {
      const { Product } = await import('digital-products')

      const myApp = Product({
        id: 'my-dotdo-app',
        name: 'My dotdo App',
        description: 'An app built with dotdo',
        version: '1.0.0',
      })

      expect(myApp).toBeDefined()
      expect(myApp.id).toBe('my-dotdo-app')

      // The app should be usable for configuration
      expect(myApp.name).toBe('My dotdo App')
    })

    it('should define multiple product types and compose them', async () => {
      const { App, API, Site, Product } = await import('digital-products')

      const baseProduct = Product({
        id: 'acme-suite',
        name: 'ACME Suite',
        description: 'Complete product suite',
        version: '2.0.0',
      })

      const frontendApp = App({
        id: 'acme-app',
        name: 'ACME App',
        description: 'Frontend application',
        version: '2.0.0',
      })

      const api = API({
        id: 'acme-api',
        name: 'ACME API',
        description: 'Backend API',
        version: '2.0.0',
      })

      const docs = Site({
        id: 'acme-docs',
        name: 'ACME Docs',
        description: 'Documentation',
        version: '2.0.0',
      })

      expect(baseProduct.id).toBe('acme-suite')
      expect(frontendApp.id).toBe('acme-app')
      expect(api.id).toBe('acme-api')
      expect(docs.id).toBe('acme-docs')
    })
  })

  describe('Product Definitions with Metadata', () => {
    it('should support metadata on product definitions', async () => {
      const { Product } = await import('digital-products')

      const product = Product({
        id: 'advanced-product',
        name: 'Advanced Product',
        description: 'A product with metadata',
        version: '1.0.0',
        metadata: {
          owner: 'engineering',
          team: 'platform',
          environment: 'production',
        },
      })

      expect(product.metadata).toBeDefined()
    })

    it('should support tags on product definitions', async () => {
      const { Product } = await import('digital-products')

      const product = Product({
        id: 'tagged-product',
        name: 'Tagged Product',
        description: 'A product with tags',
        version: '1.0.0',
        tags: ['web', 'api', 'production'],
      })

      expect(product.tags).toBeDefined()
      expect(product.tags).toContain('web')
    })
  })
})
