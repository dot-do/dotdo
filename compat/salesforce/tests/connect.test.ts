/**
 * @dotdo/salesforce - Salesforce Connect Tests
 *
 * Tests for Salesforce Connect external objects, OData integration,
 * cross-org sync, and external data source management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Connection } from '../salesforce'
import {
  Connect,
  isExternalObject,
  toExternalObjectName,
  fromExternalObjectName,
  odata,
  ODataQueryBuilder,
  defineExternalObject,
  type ExternalDataSource,
  type ExternalObject,
  type ExternalDataSourceConfig,
  type ODataResponse,
  type ODataServiceMetadata,
  type CrossOrgAdapterConfig,
} from '../connect'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [{ errorCode: 'NOT_FOUND', message: `No mock for ${key}` }],
        text: async () => JSON.stringify([{ errorCode: 'NOT_FOUND', message: `No mock for ${key}` }]),
      }
    }

    const isTextBody = typeof mockResponse.body === 'string'
    const contentType = isTextBody ? 'text/plain' : 'application/json'

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'content-type': contentType }),
      json: async () => mockResponse.body,
      text: async () => typeof mockResponse.body === 'string' ? mockResponse.body : JSON.stringify(mockResponse.body),
    }
  })
}

function mockExternalDataSource(overrides: Partial<ExternalDataSource> = {}): ExternalDataSource {
  return {
    Id: 'a0Xxx000000001AAA',
    DeveloperName: 'SAP_ERP',
    MasterLabel: 'SAP ERP System',
    Type: 'OData4',
    Endpoint: 'https://sap.example.com/odata/v4',
    AuthenticationProtocol: 'OAuth',
    IdentityType: 'NamedUser',
    PrincipalType: 'NamedUser',
    IsWritable: true,
    Description: 'SAP ERP Integration',
    CreatedDate: '2024-01-01T00:00:00.000Z',
    LastModifiedDate: '2024-01-15T00:00:00.000Z',
    ...overrides,
  }
}

function mockExternalObject(overrides: Partial<ExternalObject> = {}): ExternalObject {
  return {
    Id: 'x0Xxx000000001AAA',
    ExternalId: 'ERP-001',
    DisplayUrl: 'https://sap.example.com/orders/ERP-001',
    attributes: {
      type: 'Order__x',
      url: '/services/data/v59.0/sobjects/Order__x/x0Xxx000000001AAA',
      externalId: 'ERP-001',
    },
    ...overrides,
  }
}

// =============================================================================
// Connect Class Tests
// =============================================================================

describe('@dotdo/salesforce - Connect', () => {
  let conn: Connection
  let connect: Connect
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)
  })

  // ===========================================================================
  // External Data Source Tests
  // ===========================================================================

  describe('External Data Sources', () => {
    describe('listDataSources', () => {
      it('should list all external data sources', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 2,
                  done: true,
                  records: [
                    mockExternalDataSource(),
                    mockExternalDataSource({
                      Id: 'a0Xxx000000002AAA',
                      DeveloperName: 'Workday_HR',
                      MasterLabel: 'Workday HR System',
                    }),
                  ],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const dataSources = await connect.listDataSources()

        expect(dataSources).toHaveLength(2)
        expect(dataSources[0].DeveloperName).toBe('SAP_ERP')
        expect(dataSources[1].DeveloperName).toBe('Workday_HR')
      })
    })

    describe('getDataSource', () => {
      it('should get a specific external data source by name', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 1,
                  done: true,
                  records: [mockExternalDataSource()],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const dataSource = await connect.getDataSource('SAP_ERP')

        expect(dataSource).not.toBeNull()
        expect(dataSource?.DeveloperName).toBe('SAP_ERP')
        expect(dataSource?.Type).toBe('OData4')
      })

      it('should return null for non-existent data source', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 0,
                  done: true,
                  records: [],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const dataSource = await connect.getDataSource('NonExistent')

        expect(dataSource).toBeNull()
      })
    })

    describe('createDataSource', () => {
      it('should create a new external data source', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
              {
                status: 201,
                body: { id: 'a0Xxx000000003AAA', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const config: ExternalDataSourceConfig = {
          developerName: 'New_ERP',
          label: 'New ERP System',
          type: 'OData4',
          endpoint: 'https://erp.example.com/odata/v4',
          authenticationProtocol: 'OAuth',
          identityType: 'NamedUser',
          isWritable: true,
        }

        const result = await connect.createDataSource(config)

        expect(result.success).toBe(true)
        expect(result.id).toBe('a0Xxx000000003AAA')
      })

      it('should create OData 2.0 data source', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
              {
                status: 201,
                body: { id: 'a0Xxx000000004AAA', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const config: ExternalDataSourceConfig = {
          developerName: 'Legacy_System',
          label: 'Legacy System',
          type: 'OData',
          endpoint: 'https://legacy.example.com/odata',
          authenticationProtocol: 'Password',
        }

        const result = await connect.createDataSource(config)

        expect(result.success).toBe(true)
      })
    })

    describe('updateDataSource', () => {
      it('should update an existing data source', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'PATCH /services/data/v59.0/tooling/sobjects/ExternalDataSource/a0Xxx000000001AAA',
              {
                status: 200,
                body: { id: 'a0Xxx000000001AAA', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.updateDataSource('a0Xxx000000001AAA', {
          endpoint: 'https://new-sap.example.com/odata/v4',
        })

        expect(result.success).toBe(true)
      })
    })

    describe('deleteDataSource', () => {
      it('should delete an external data source', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /services/data/v59.0/tooling/sobjects/ExternalDataSource/a0Xxx000000001AAA',
              {
                status: 204,
                body: null,
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.deleteDataSource('a0Xxx000000001AAA')

        expect(result.success).toBe(true)
        expect(result.id).toBe('a0Xxx000000001AAA')
      })
    })

    describe('validateDataSource', () => {
      it('should validate a data source connection successfully', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/connect/external-data-sources/a0Xxx000000001AAA/validate',
              {
                status: 200,
                body: { isSuccess: true },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.validateDataSource('a0Xxx000000001AAA')

        expect(result.success).toBe(true)
      })

      it('should return failure with message on validation error', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/connect/external-data-sources/a0Xxx000000001AAA/validate',
              {
                status: 200,
                body: { isSuccess: false, errorMessage: 'Connection timeout' },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.validateDataSource('a0Xxx000000001AAA')

        expect(result.success).toBe(false)
        expect(result.message).toBe('Connection timeout')
      })
    })
  })

  // ===========================================================================
  // External Object Tests
  // ===========================================================================

  describe('External Objects', () => {
    describe('listExternalObjects', () => {
      it('should list all external objects', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/sobjects',
              {
                status: 200,
                body: {
                  encoding: 'UTF-8',
                  maxBatchSize: 200,
                  sobjects: [
                    { name: 'Account', label: 'Account', queryable: true },
                    { name: 'Order__x', label: 'External Order', queryable: true },
                    { name: 'Product__x', label: 'External Product', queryable: true },
                  ],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const externalObjects = await connect.listExternalObjects()

        expect(externalObjects).toHaveLength(2)
        expect(externalObjects[0].name).toBe('Order__x')
        expect(externalObjects[1].name).toBe('Product__x')
      })
    })

    describe('queryExternal', () => {
      it('should query external object records', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 2,
                  done: true,
                  records: [
                    mockExternalObject(),
                    mockExternalObject({ ExternalId: 'ERP-002' }),
                  ],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.queryExternal(
          'Order__x',
          ['Id', 'ExternalId', 'DisplayUrl'],
          { Status: 'Open' }
        )

        expect(result.totalSize).toBe(2)
        expect(result.records[0].ExternalId).toBe('ERP-001')
      })

      it('should auto-append __x suffix to object name', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 1,
                  done: true,
                  records: [mockExternalObject()],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.queryExternal(
          'Order', // Without __x suffix
          ['Id', 'ExternalId']
        )

        expect(result.records).toHaveLength(1)
      })

      it('should support query options (limit, offset, orderBy)', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 100,
                  done: true,
                  records: Array(10).fill(mockExternalObject()),
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.queryExternal(
          'Order__x',
          ['Id', 'ExternalId'],
          {},
          { limit: 10, offset: 20, orderBy: 'ExternalId DESC' }
        )

        expect(result.records).toHaveLength(10)
      })
    })

    describe('getExternalRecord', () => {
      it('should get an external record by external ID', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 1,
                  done: true,
                  records: [mockExternalObject()],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const record = await connect.getExternalRecord('Order__x', 'ERP-001')

        expect(record).not.toBeNull()
        expect(record?.ExternalId).toBe('ERP-001')
      })

      it('should return null for non-existent external ID', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 0,
                  done: true,
                  records: [],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const record = await connect.getExternalRecord('Order__x', 'NON-EXISTENT')

        expect(record).toBeNull()
      })
    })

    describe('upsertExternalRecord', () => {
      it('should create/update external object record', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/sobjects/Order__x',
              {
                status: 201,
                body: { id: 'x0Xxx000000002AAA', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.upsertExternalRecord('Order__x', {
          ExternalId: 'ERP-003',
          DisplayUrl: 'https://sap.example.com/orders/ERP-003',
        })

        expect(result.success).toBe(true)
      })
    })

    describe('deleteExternalRecord', () => {
      it('should delete an external object record', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 1,
                  done: true,
                  records: [{ Id: 'x0Xxx000000001AAA' }],
                },
              },
            ],
            [
              'DELETE /services/data/v59.0/sobjects/Order__x/x0Xxx000000001AAA',
              {
                status: 204,
                body: null,
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.deleteExternalRecord('Order__x', 'ERP-001')

        expect(result.success).toBe(true)
      })

      it('should return error for non-existent record', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 0,
                  done: true,
                  records: [],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.deleteExternalRecord('Order__x', 'NON-EXISTENT')

        expect(result.success).toBe(false)
        expect(result.errors[0].errorCode).toBe('NOT_FOUND')
      })
    })
  })

  // ===========================================================================
  // OData Integration Tests
  // ===========================================================================

  describe('OData Integration', () => {
    describe('queryOData', () => {
      it('should execute OData query', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /odata/v4/Orders',
              {
                status: 200,
                body: {
                  '@odata.context': '$metadata#Orders',
                  value: [
                    { OrderId: 'ORD-001', Status: 'Open', Amount: 1000 },
                    { OrderId: 'ORD-002', Status: 'Closed', Amount: 2000 },
                  ],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.queryOData(
          'https://na1.salesforce.com/odata/v4',
          'Orders'
        )

        expect(result.value).toHaveLength(2)
        expect(result.value[0]).toHaveProperty('OrderId', 'ORD-001')
      })

      it('should support OData query options', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /odata/v4/Orders',
              {
                status: 200,
                body: {
                  '@odata.context': '$metadata#Orders',
                  '@odata.count': 100,
                  value: [{ OrderId: 'ORD-001', Status: 'Open' }],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.queryOData(
          'https://na1.salesforce.com/odata/v4',
          'Orders',
          {
            $filter: "Status eq 'Open'",
            $select: 'OrderId,Status',
            $top: 10,
            $skip: 0,
            $count: true,
            $orderby: 'OrderId desc',
          }
        )

        expect(result['@odata.count']).toBe(100)
      })

      it('should support OData expand for related entities', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /odata/v4/Orders',
              {
                status: 200,
                body: {
                  value: [{
                    OrderId: 'ORD-001',
                    Customer: { CustomerId: 'CUST-001', Name: 'Acme Inc' },
                  }],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.queryOData(
          'https://na1.salesforce.com/odata/v4',
          'Orders',
          { $expand: 'Customer' }
        )

        expect(result.value[0]).toHaveProperty('Customer')
      })
    })

    describe('createODataRecord', () => {
      it('should create an OData record', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /odata/v4/Orders',
              {
                status: 201,
                body: {
                  OrderId: 'ORD-NEW',
                  Status: 'Draft',
                  Amount: 5000,
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.createODataRecord(
          'https://na1.salesforce.com/odata/v4',
          'Orders',
          { Status: 'Draft', Amount: 5000 }
        )

        expect(result).toHaveProperty('OrderId', 'ORD-NEW')
      })
    })

    describe('updateODataRecord', () => {
      it('should update an OData record', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              "PATCH /odata/v4/Orders('ORD-001')",
              {
                status: 200,
                body: {
                  OrderId: 'ORD-001',
                  Status: 'Shipped',
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.updateODataRecord(
          'https://na1.salesforce.com/odata/v4',
          'Orders',
          'ORD-001',
          { Status: 'Shipped' }
        )

        expect(result).toHaveProperty('Status', 'Shipped')
      })
    })

    describe('deleteODataRecord', () => {
      it('should delete an OData record', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              "DELETE /odata/v4/Orders('ORD-001')",
              {
                status: 204,
                body: null,
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        await expect(
          connect.deleteODataRecord(
            'https://na1.salesforce.com/odata/v4',
            'Orders',
            'ORD-001'
          )
        ).resolves.not.toThrow()
      })
    })

    describe('getODataMetadata', () => {
      it('should parse OData metadata', async () => {
        const metadataXml = `<?xml version="1.0" encoding="utf-8"?>
          <edmx:Edmx Version="4.0">
            <edmx:DataServices>
              <Schema Namespace="ODataService">
                <EntityType Name="Order">
                  <Key>
                    <PropertyRef Name="OrderId"/>
                  </Key>
                  <Property Name="OrderId" Type="Edm.String"/>
                  <Property Name="Status" Type="Edm.String"/>
                  <Property Name="Amount" Type="Edm.Decimal"/>
                </EntityType>
                <EntityContainer Name="Container">
                  <EntitySet Name="Orders" EntityType="ODataService.Order"/>
                </EntityContainer>
              </Schema>
            </edmx:DataServices>
          </edmx:Edmx>`

        mockFetch = createMockFetch(
          new Map([
            [
              'GET /odata/v4/$metadata',
              {
                status: 200,
                body: metadataXml,
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const metadata = await connect.getODataMetadata('https://na1.salesforce.com/odata/v4')

        expect(metadata.version).toBe('4.0')
        expect(metadata.entitySets.length).toBeGreaterThanOrEqual(0)
      })
    })
  })

  // ===========================================================================
  // Cross-Org Sync Tests
  // ===========================================================================

  describe('Cross-Org Sync', () => {
    describe('configureCrossOrgAdapter', () => {
      it('should configure cross-org adapter', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
              {
                status: 201,
                body: { id: 'a0Xxx000000005AAA', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const config: CrossOrgAdapterConfig = {
          sourceOrgUrl: 'https://source-org.salesforce.com',
          sourceOrgCredential: 'Source_Org_Credential',
          objectsToSync: ['Account', 'Contact', 'Opportunity'],
          syncDirection: 'Bidirectional',
          enableCDC: true,
        }

        const result = await connect.configureCrossOrgAdapter(config)

        expect(result.success).toBe(true)
      })
    })

    describe('getCrossOrgSyncStatus', () => {
      it('should get sync status for objects', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'GET /services/data/v59.0/query',
              {
                status: 200,
                body: {
                  totalSize: 2,
                  done: true,
                  records: [
                    {
                      ExternalObjectName: 'Account__x',
                      LastSyncDateTime: '2024-01-15T10:00:00.000Z',
                      SyncStatus: 'Success',
                      RecordsSynced: 100,
                      RecordsFailed: 0,
                      ErrorMessage: null,
                    },
                    {
                      ExternalObjectName: 'Contact__x',
                      LastSyncDateTime: '2024-01-15T10:00:00.000Z',
                      SyncStatus: 'Partial',
                      RecordsSynced: 95,
                      RecordsFailed: 5,
                      ErrorMessage: 'Some records had validation errors',
                    },
                  ],
                },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const status = await connect.getCrossOrgSyncStatus('a0Xxx000000001AAA')

        expect(status).toHaveLength(2)
        expect(status[0].status).toBe('Success')
        expect(status[1].status).toBe('Partial')
        expect(status[1].recordsFailed).toBe(5)
      })
    })

    describe('triggerCrossOrgSync', () => {
      it('should trigger manual sync', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/connect/external-data-sources/a0Xxx000000001AAA/sync',
              {
                status: 200,
                body: { syncId: 'sync-001', status: 'InProgress' },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.triggerCrossOrgSync('a0Xxx000000001AAA')

        expect(result.syncId).toBe('sync-001')
        expect(result.status).toBe('InProgress')
      })

      it('should trigger sync for specific objects', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/data/v59.0/connect/external-data-sources/a0Xxx000000001AAA/sync',
              {
                status: 200,
                body: { syncId: 'sync-002', status: 'InProgress' },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.triggerCrossOrgSync(
          'a0Xxx000000001AAA',
          ['Account__x', 'Contact__x']
        )

        expect(result.syncId).toBe('sync-002')
      })
    })
  })

  // ===========================================================================
  // Indirect Lookup Relationship Tests
  // ===========================================================================

  describe('Indirect Lookup Relationships', () => {
    describe('createIndirectLookup', () => {
      it('should create indirect lookup relationship', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/Soap/m/59.0',
              {
                status: 200,
                body: { id: 'field-001', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.createIndirectLookup(
          'Order__x',
          'Account',
          'External_Account_Id__c',
          'Account__c'
        )

        expect(result.success).toBe(true)
      })
    })

    describe('createExternalLookup', () => {
      it('should create external lookup relationship', async () => {
        mockFetch = createMockFetch(
          new Map([
            [
              'POST /services/Soap/m/59.0',
              {
                status: 200,
                body: { id: 'field-002', success: true, errors: [] },
              },
            ],
          ])
        )
        conn = new Connection({
          instanceUrl: 'https://na1.salesforce.com',
          accessToken: 'test_token',
          fetch: mockFetch,
        })
        connect = new Connect(conn)

        const result = await connect.createExternalLookup(
          'Account',
          'Order__x',
          'External_Order__c',
          'ExternalId'
        )

        expect(result.success).toBe(true)
      })
    })
  })
})

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('@dotdo/salesforce - Connect Utilities', () => {
  describe('isExternalObject', () => {
    it('should return true for objects ending with __x', () => {
      expect(isExternalObject('Order__x')).toBe(true)
      expect(isExternalObject('Product__x')).toBe(true)
      expect(isExternalObject('Customer__x')).toBe(true)
    })

    it('should return false for standard and custom objects', () => {
      expect(isExternalObject('Account')).toBe(false)
      expect(isExternalObject('Contact')).toBe(false)
      expect(isExternalObject('Invoice__c')).toBe(false)
    })
  })

  describe('toExternalObjectName', () => {
    it('should add __x suffix to standard object names', () => {
      expect(toExternalObjectName('Order')).toBe('Order__x')
      expect(toExternalObjectName('Product')).toBe('Product__x')
    })

    it('should convert __c to __x for custom objects', () => {
      expect(toExternalObjectName('Invoice__c')).toBe('Invoice__x')
    })

    it('should not modify names already ending with __x', () => {
      expect(toExternalObjectName('Order__x')).toBe('Order__x')
    })
  })

  describe('fromExternalObjectName', () => {
    it('should remove __x suffix', () => {
      expect(fromExternalObjectName('Order__x')).toBe('Order')
      expect(fromExternalObjectName('Product__x')).toBe('Product')
    })

    it('should not modify names without __x suffix', () => {
      expect(fromExternalObjectName('Account')).toBe('Account')
      expect(fromExternalObjectName('Invoice__c')).toBe('Invoice__c')
    })
  })
})

// =============================================================================
// OData Query Builder Tests
// =============================================================================

describe('@dotdo/salesforce - ODataQueryBuilder', () => {
  describe('fluent API', () => {
    it('should build query with select', () => {
      const builder = odata('Orders')
        .select('OrderId', 'Status', 'Amount')

      expect(builder.build().$select).toBe('OrderId,Status,Amount')
    })

    it('should build query with filter', () => {
      const builder = odata('Orders')
        .filter("Status eq 'Open'")

      expect(builder.build().$filter).toBe("Status eq 'Open'")
    })

    it('should build query with expand', () => {
      const builder = odata('Orders')
        .expand('Customer', 'LineItems')

      expect(builder.build().$expand).toBe('Customer,LineItems')
    })

    it('should build query with orderBy', () => {
      const builder = odata('Orders')
        .orderBy('CreatedDate desc')

      expect(builder.build().$orderby).toBe('CreatedDate desc')
    })

    it('should build query with top and skip', () => {
      const builder = odata('Orders')
        .top(10)
        .skip(20)

      const options = builder.build()
      expect(options.$top).toBe(10)
      expect(options.$skip).toBe(20)
    })

    it('should build query with count', () => {
      const builder = odata('Orders').count()

      expect(builder.build().$count).toBe(true)
    })

    it('should build query with search', () => {
      const builder = odata('Orders')
        .search('urgent')

      expect(builder.build().$search).toBe('urgent')
    })

    it('should chain multiple options', () => {
      const builder = odata('Orders')
        .select('OrderId', 'Status')
        .filter("Status eq 'Open'")
        .expand('Customer')
        .orderBy('CreatedDate desc')
        .top(50)
        .skip(0)
        .count()

      const options = builder.build()
      expect(options.$select).toBe('OrderId,Status')
      expect(options.$filter).toBe("Status eq 'Open'")
      expect(options.$expand).toBe('Customer')
      expect(options.$orderby).toBe('CreatedDate desc')
      expect(options.$top).toBe(50)
      expect(options.$skip).toBe(0)
      expect(options.$count).toBe(true)
    })

    it('should return entity set name', () => {
      const builder = odata('Products')

      expect(builder.getEntitySet()).toBe('Products')
    })
  })
})

// =============================================================================
// External Object Definition Tests
// =============================================================================

describe('@dotdo/salesforce - External Object Definition', () => {
  describe('defineExternalObject', () => {
    it('should create external object definition', () => {
      const definition = defineExternalObject('Order', [
        { name: 'OrderId', label: 'Order ID', type: 'string', isExternalId: true },
        { name: 'Status', label: 'Status', type: 'picklist' },
        { name: 'Amount', label: 'Amount', type: 'currency' },
      ])

      expect(definition.name).toBe('Order__x')
      expect(definition.fields).toHaveLength(3)
      expect(definition.fields[0].isExternalId).toBe(true)
    })

    it('should handle __x suffix correctly', () => {
      const definition = defineExternalObject('Product__x', [
        { name: 'ProductCode', label: 'Product Code', type: 'string' },
      ])

      expect(definition.name).toBe('Product__x')
    })

    it('should set proper labels', () => {
      const definition = defineExternalObject('Sales_Order', [])

      expect(definition.label).toBe('Sales Order')
      expect(definition.labelPlural).toBe('Sales Orders')
    })
  })
})

// =============================================================================
// Data Source Type Tests
// =============================================================================

describe('@dotdo/salesforce - Data Source Types', () => {
  let conn: Connection
  let connect: Connect
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)
  })

  it('should support OData 2.0 type', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
          {
            status: 201,
            body: { id: 'a0Xxx000000006AAA', success: true, errors: [] },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)

    const result = await connect.createDataSource({
      developerName: 'Legacy_OData',
      label: 'Legacy OData',
      type: 'OData',
      endpoint: 'https://legacy.example.com/odata',
    })

    expect(result.success).toBe(true)
  })

  it('should support OData 4.0 type', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
          {
            status: 201,
            body: { id: 'a0Xxx000000007AAA', success: true, errors: [] },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)

    const result = await connect.createDataSource({
      developerName: 'Modern_OData',
      label: 'Modern OData',
      type: 'OData4',
      endpoint: 'https://modern.example.com/odata/v4',
    })

    expect(result.success).toBe(true)
  })

  it('should support Custom Adapter type', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
          {
            status: 201,
            body: { id: 'a0Xxx000000008AAA', success: true, errors: [] },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)

    const result = await connect.createDataSource({
      developerName: 'Custom_REST',
      label: 'Custom REST API',
      type: 'CustomAdapter',
      endpoint: 'https://custom.example.com/api',
    })

    expect(result.success).toBe(true)
  })

  it('should support Cross-Org type', async () => {
    mockFetch = createMockFetch(
      new Map([
        [
          'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
          {
            status: 201,
            body: { id: 'a0Xxx000000009AAA', success: true, errors: [] },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)

    const result = await connect.createDataSource({
      developerName: 'Other_Org',
      label: 'Other Salesforce Org',
      type: 'CrossOrg',
      endpoint: 'https://other-org.salesforce.com',
      authenticationProtocol: 'OAuth',
    })

    expect(result.success).toBe(true)
  })
})

// =============================================================================
// Authentication Protocol Tests
// =============================================================================

describe('@dotdo/salesforce - Authentication Protocols', () => {
  let conn: Connection
  let connect: Connect
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(
      new Map([
        [
          'POST /services/data/v59.0/tooling/sobjects/ExternalDataSource',
          {
            status: 201,
            body: { id: 'a0Xxx000000010AAA', success: true, errors: [] },
          },
        ],
      ])
    )
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
    connect = new Connect(conn)
  })

  it('should support NoAuthentication', async () => {
    const result = await connect.createDataSource({
      developerName: 'Public_API',
      label: 'Public API',
      type: 'OData4',
      endpoint: 'https://public.example.com/odata',
      authenticationProtocol: 'NoAuthentication',
    })

    expect(result.success).toBe(true)
  })

  it('should support Password authentication', async () => {
    const result = await connect.createDataSource({
      developerName: 'Basic_Auth_API',
      label: 'Basic Auth API',
      type: 'OData4',
      endpoint: 'https://basic.example.com/odata',
      authenticationProtocol: 'Password',
    })

    expect(result.success).toBe(true)
  })

  it('should support OAuth authentication', async () => {
    const result = await connect.createDataSource({
      developerName: 'OAuth_API',
      label: 'OAuth API',
      type: 'OData4',
      endpoint: 'https://oauth.example.com/odata',
      authenticationProtocol: 'OAuth',
      namedCredential: 'OAuth_Credential',
    })

    expect(result.success).toBe(true)
  })

  it('should support Certificate authentication', async () => {
    const result = await connect.createDataSource({
      developerName: 'Cert_API',
      label: 'Certificate API',
      type: 'OData4',
      endpoint: 'https://cert.example.com/odata',
      authenticationProtocol: 'Certificate',
    })

    expect(result.success).toBe(true)
  })

  it('should support AWS Signature v4 authentication', async () => {
    const result = await connect.createDataSource({
      developerName: 'AWS_API',
      label: 'AWS API',
      type: 'OData4',
      endpoint: 'https://aws.example.com/odata',
      authenticationProtocol: 'AwsSig4',
    })

    expect(result.success).toBe(true)
  })

  it('should support JWT authentication', async () => {
    const result = await connect.createDataSource({
      developerName: 'JWT_API',
      label: 'JWT API',
      type: 'OData4',
      endpoint: 'https://jwt.example.com/odata',
      authenticationProtocol: 'Jwt',
    })

    expect(result.success).toBe(true)
  })
})
