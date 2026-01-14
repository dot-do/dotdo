/**
 * @dotdo/salesforce - Standard Salesforce Object Type Definitions
 *
 * Type-safe interfaces for standard Salesforce objects (Account, Contact, Lead, etc.)
 * These types match the Salesforce REST API schema for standard SObjects.
 *
 * @module @dotdo/salesforce/objects
 */

import type { SObject, SObjectAttributes } from './types'

// =============================================================================
// Base Standard Object
// =============================================================================

/**
 * Base interface for all standard Salesforce objects
 * Includes common system fields present on all SObjects
 */
export interface StandardObject extends SObject {
  Id?: string
  attributes?: SObjectAttributes
  IsDeleted?: boolean
  CreatedDate?: string
  CreatedById?: string
  LastModifiedDate?: string
  LastModifiedById?: string
  SystemModstamp?: string
  LastActivityDate?: string | null
  LastViewedDate?: string | null
  LastReferencedDate?: string | null
}

// =============================================================================
// Account
// =============================================================================

/**
 * Salesforce Account - represents a business entity
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_account.htm
 */
export interface Account extends StandardObject {
  // Name fields
  Name: string

  // Account type and classification
  Type?: AccountType | string | null
  Industry?: Industry | string | null
  AccountSource?: LeadSource | string | null
  Rating?: AccountRating | string | null

  // Contact information
  Phone?: string | null
  Fax?: string | null
  Website?: string | null

  // Address fields
  BillingStreet?: string | null
  BillingCity?: string | null
  BillingState?: string | null
  BillingPostalCode?: string | null
  BillingCountry?: string | null
  BillingLatitude?: number | null
  BillingLongitude?: number | null
  BillingGeocodeAccuracy?: GeocodeAccuracy | null

  ShippingStreet?: string | null
  ShippingCity?: string | null
  ShippingState?: string | null
  ShippingPostalCode?: string | null
  ShippingCountry?: string | null
  ShippingLatitude?: number | null
  ShippingLongitude?: number | null
  ShippingGeocodeAccuracy?: GeocodeAccuracy | null

  // Business info
  Description?: string | null
  NumberOfEmployees?: number | null
  AnnualRevenue?: number | null
  Ownership?: Ownership | string | null
  TickerSymbol?: string | null
  Sic?: string | null
  SicDesc?: string | null
  NaicsCode?: string | null
  NaicsDesc?: string | null
  YearStarted?: string | null
  DunsNumber?: string | null

  // Relationships
  OwnerId?: string | null
  ParentId?: string | null

  // Integration
  Jigsaw?: string | null
  JigsawCompanyId?: string | null
  AccountNumber?: string | null
  Site?: string | null

  // Record metadata
  PhotoUrl?: string | null
  CleanStatus?: CleanStatus | null
  MasterRecordId?: string | null

  // Computed fields (read-only)
  OperatingHoursId?: string | null
}

/**
 * Account type picklist values
 */
export type AccountType =
  | 'Prospect'
  | 'Customer - Direct'
  | 'Customer - Channel'
  | 'Channel Partner / Reseller'
  | 'Installation Partner'
  | 'Technology Partner'
  | 'Other'

/**
 * Account rating picklist values
 */
export type AccountRating = 'Hot' | 'Warm' | 'Cold'

/**
 * Ownership type picklist values
 */
export type Ownership =
  | 'Public'
  | 'Private'
  | 'Subsidiary'
  | 'Other'

/**
 * Clean status for Data.com
 */
export type CleanStatus =
  | 'Matched'
  | 'Different'
  | 'Acknowledged'
  | 'NotFound'
  | 'Inactive'
  | 'Pending'
  | 'SelectMatch'
  | 'Skipped'

/**
 * Geocode accuracy levels
 */
export type GeocodeAccuracy =
  | 'Address'
  | 'NearAddress'
  | 'Block'
  | 'Street'
  | 'ExtendedZip'
  | 'Zip'
  | 'Neighborhood'
  | 'City'
  | 'County'
  | 'State'
  | 'Unknown'

// =============================================================================
// Contact
// =============================================================================

/**
 * Salesforce Contact - represents an individual person associated with an Account
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contact.htm
 */
export interface Contact extends StandardObject {
  // Name fields
  FirstName?: string | null
  LastName: string
  MiddleName?: string | null
  Suffix?: string | null
  Salutation?: Salutation | string | null
  Name?: string // Compound field (read-only)

  // Contact information
  Email?: string | null
  Phone?: string | null
  MobilePhone?: string | null
  HomePhone?: string | null
  OtherPhone?: string | null
  Fax?: string | null
  AssistantPhone?: string | null
  AssistantName?: string | null

  // Address fields
  MailingStreet?: string | null
  MailingCity?: string | null
  MailingState?: string | null
  MailingPostalCode?: string | null
  MailingCountry?: string | null
  MailingLatitude?: number | null
  MailingLongitude?: number | null
  MailingGeocodeAccuracy?: GeocodeAccuracy | null

  OtherStreet?: string | null
  OtherCity?: string | null
  OtherState?: string | null
  OtherPostalCode?: string | null
  OtherCountry?: string | null
  OtherLatitude?: number | null
  OtherLongitude?: number | null
  OtherGeocodeAccuracy?: GeocodeAccuracy | null

  // Job information
  Title?: string | null
  Department?: string | null

  // Business info
  Description?: string | null
  Birthdate?: string | null
  LeadSource?: LeadSource | string | null
  HasOptedOutOfEmail?: boolean
  HasOptedOutOfFax?: boolean
  DoNotCall?: boolean
  EmailBouncedReason?: string | null
  EmailBouncedDate?: string | null

  // Relationships
  AccountId?: string | null
  OwnerId?: string | null
  ReportsToId?: string | null

  // Integration
  Jigsaw?: string | null
  JigsawContactId?: string | null

  // Computed fields (read-only)
  PhotoUrl?: string | null
  CleanStatus?: CleanStatus | null
  MasterRecordId?: string | null
  Level__c?: string | null
  Languages__c?: string | null
}

/**
 * Salutation picklist values
 */
export type Salutation =
  | 'Mr.'
  | 'Ms.'
  | 'Mrs.'
  | 'Dr.'
  | 'Prof.'

// =============================================================================
// Lead
// =============================================================================

/**
 * Salesforce Lead - represents a potential customer before qualification
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_lead.htm
 */
export interface Lead extends StandardObject {
  // Name fields
  FirstName?: string | null
  LastName: string
  MiddleName?: string | null
  Suffix?: string | null
  Salutation?: Salutation | string | null
  Name?: string // Compound field (read-only)

  // Company information
  Company: string
  Title?: string | null
  Industry?: Industry | string | null
  NumberOfEmployees?: number | null
  AnnualRevenue?: number | null

  // Contact information
  Email?: string | null
  Phone?: string | null
  MobilePhone?: string | null
  Fax?: string | null
  Website?: string | null

  // Address fields
  Street?: string | null
  City?: string | null
  State?: string | null
  PostalCode?: string | null
  Country?: string | null
  Latitude?: number | null
  Longitude?: number | null
  GeocodeAccuracy?: GeocodeAccuracy | null

  // Lead details
  Description?: string | null
  LeadSource?: LeadSource | string | null
  Status: LeadStatus | string
  Rating?: LeadRating | string | null

  // Email preferences
  HasOptedOutOfEmail?: boolean
  HasOptedOutOfFax?: boolean
  DoNotCall?: boolean
  EmailBouncedReason?: string | null
  EmailBouncedDate?: string | null

  // Relationships
  OwnerId?: string | null
  ConvertedAccountId?: string | null
  ConvertedContactId?: string | null
  ConvertedOpportunityId?: string | null
  ConvertedDate?: string | null
  IsConverted?: boolean
  IsUnreadByOwner?: boolean

  // Integration
  Jigsaw?: string | null
  JigsawContactId?: string | null
  CampaignId?: string | null

  // Computed fields (read-only)
  PhotoUrl?: string | null
  CleanStatus?: CleanStatus | null
  MasterRecordId?: string | null
  CompanyDunsNumber?: string | null
  DandbCompanyId?: string | null
  IndividualId?: string | null
}

/**
 * Lead status picklist values
 */
export type LeadStatus =
  | 'Open - Not Contacted'
  | 'Working - Contacted'
  | 'Closed - Converted'
  | 'Closed - Not Converted'

/**
 * Lead rating picklist values
 */
export type LeadRating = 'Hot' | 'Warm' | 'Cold'

/**
 * Lead source picklist values (also used for Contact and Opportunity)
 */
export type LeadSource =
  | 'Web'
  | 'Phone Inquiry'
  | 'Partner Referral'
  | 'Purchased List'
  | 'Other'
  | 'Trade Show'
  | 'Employee Referral'
  | 'External Referral'
  | 'Public Relations'
  | 'Direct Mail'
  | 'Advertisement'
  | 'Word of mouth'
  | 'Social'

/**
 * Industry picklist values
 */
export type Industry =
  | 'Agriculture'
  | 'Apparel'
  | 'Banking'
  | 'Biotechnology'
  | 'Chemicals'
  | 'Communications'
  | 'Construction'
  | 'Consulting'
  | 'Education'
  | 'Electronics'
  | 'Energy'
  | 'Engineering'
  | 'Entertainment'
  | 'Environmental'
  | 'Finance'
  | 'Food & Beverage'
  | 'Government'
  | 'Healthcare'
  | 'Hospitality'
  | 'Insurance'
  | 'Machinery'
  | 'Manufacturing'
  | 'Media'
  | 'Not For Profit'
  | 'Other'
  | 'Recreation'
  | 'Retail'
  | 'Shipping'
  | 'Technology'
  | 'Telecommunications'
  | 'Transportation'
  | 'Utilities'

// =============================================================================
// Opportunity
// =============================================================================

/**
 * Salesforce Opportunity - represents a potential sale or pending deal
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunity.htm
 */
export interface Opportunity extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null

  // Amounts
  Amount?: number | null
  ExpectedRevenue?: number | null
  Probability?: number | null

  // Dates
  CloseDate: string
  NextStep?: string | null

  // Stage and status
  StageName: OpportunityStage | string
  Type?: OpportunityType | string | null
  LeadSource?: LeadSource | string | null
  ForecastCategory?: ForecastCategory | string | null
  ForecastCategoryName?: string | null

  // Flags
  IsClosed?: boolean
  IsWon?: boolean
  HasOpportunityLineItem?: boolean
  IsPrivate?: boolean

  // Relationships
  AccountId?: string | null
  OwnerId?: string | null
  CampaignId?: string | null
  ContactId?: string | null
  ContractId?: string | null
  Pricebook2Id?: string | null

  // Territory
  TerritoryId?: string | null
  Territory2Id?: string | null

  // Fiscal period (read-only)
  FiscalQuarter?: number | null
  FiscalYear?: number | null
  Fiscal?: string | null

  // Computed (read-only)
  LastAmountChangedHistoryId?: string | null
  LastCloseDateChangedHistoryId?: string | null
  HasOverdueTask?: boolean
  HasOpenActivity?: boolean
  LastStageChangeDate?: string | null

  // Push count (Salesforce internal)
  PushCount?: number | null
}

/**
 * Opportunity stage picklist values
 */
export type OpportunityStage =
  | 'Prospecting'
  | 'Qualification'
  | 'Needs Analysis'
  | 'Value Proposition'
  | 'Id. Decision Makers'
  | 'Perception Analysis'
  | 'Proposal/Price Quote'
  | 'Negotiation/Review'
  | 'Closed Won'
  | 'Closed Lost'

/**
 * Opportunity type picklist values
 */
export type OpportunityType =
  | 'Existing Customer - Upgrade'
  | 'Existing Customer - Replacement'
  | 'Existing Customer - Downgrade'
  | 'New Customer'

/**
 * Forecast category values
 */
export type ForecastCategory =
  | 'Omitted'
  | 'Pipeline'
  | 'Best Case'
  | 'Commit'
  | 'Closed'

// =============================================================================
// Case
// =============================================================================

/**
 * Salesforce Case - represents a customer service issue or problem
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_case.htm
 */
export interface Case extends StandardObject {
  // Case details
  Subject?: string | null
  Description?: string | null
  Comments?: string | null
  CaseNumber?: string // Auto-generated (read-only)

  // Status and priority
  Status: CaseStatus | string
  Priority?: CasePriority | string | null
  Origin?: CaseOrigin | string | null
  Type?: CaseType | string | null
  Reason?: CaseReason | string | null

  // Flags
  IsClosed?: boolean
  IsEscalated?: boolean
  IsClosedOnCreate?: boolean

  // Dates
  ClosedDate?: string | null
  SlaStartDate?: string | null
  SlaExitDate?: string | null

  // Contact information
  SuppliedName?: string | null
  SuppliedEmail?: string | null
  SuppliedPhone?: string | null
  SuppliedCompany?: string | null

  // Web information
  ContactEmail?: string | null
  ContactPhone?: string | null
  ContactMobile?: string | null
  ContactFax?: string | null

  // Relationships
  AccountId?: string | null
  ContactId?: string | null
  OwnerId?: string | null
  ParentId?: string | null
  AssetId?: string | null
  SourceId?: string | null
  EntitlementId?: string | null
  ServiceContractId?: string | null
  BusinessHoursId?: string | null

  // SLA (read-only)
  IsStopped?: boolean
  StopStartDate?: string | null
  MilestoneStatus?: string | null

  // Computed (read-only)
  MasterRecordId?: string | null
  HasCommentsUnreadByOwner?: boolean
  HasSelfServiceComments?: boolean
}

/**
 * Case status picklist values
 */
export type CaseStatus =
  | 'New'
  | 'Working'
  | 'Escalated'
  | 'Closed'

/**
 * Case priority picklist values
 */
export type CasePriority =
  | 'High'
  | 'Medium'
  | 'Low'

/**
 * Case origin picklist values
 */
export type CaseOrigin =
  | 'Phone'
  | 'Email'
  | 'Web'

/**
 * Case type picklist values
 */
export type CaseType =
  | 'Mechanical'
  | 'Electrical'
  | 'Electronic'
  | 'Structural'
  | 'Other'
  | 'Problem'
  | 'Feature Request'
  | 'Question'

/**
 * Case reason picklist values
 */
export type CaseReason =
  | 'Installation'
  | 'Equipment Complexity'
  | 'Performance'
  | 'Breakdown'
  | 'Equipment Design'
  | 'Feedback'
  | 'Other'

// =============================================================================
// Task
// =============================================================================

/**
 * Salesforce Task - represents a to-do item or action
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_task.htm
 */
export interface Task extends StandardObject {
  // Basic info
  Subject?: string | null
  Description?: string | null

  // Status and priority
  Status: TaskStatus | string
  Priority?: TaskPriority | string | null
  Type?: TaskType | string | null

  // Dates
  ActivityDate?: string | null
  TaskSubtype?: TaskSubtype | string | null

  // Duration
  CallDurationInSeconds?: number | null
  CallType?: CallType | string | null
  CallDisposition?: string | null
  CallObject?: string | null

  // Flags
  IsClosed?: boolean
  IsHighPriority?: boolean
  IsRecurrence?: boolean
  IsReminderSet?: boolean
  IsArchived?: boolean

  // Reminder
  ReminderDateTime?: string | null

  // Recurrence fields
  RecurrenceStartDateOnly?: string | null
  RecurrenceEndDateOnly?: string | null
  RecurrenceType?: RecurrenceType | null
  RecurrenceInterval?: number | null
  RecurrenceDayOfWeekMask?: number | null
  RecurrenceDayOfMonth?: number | null
  RecurrenceInstance?: RecurrenceInstance | null
  RecurrenceMonthOfYear?: RecurrenceMonth | null
  RecurrenceTimeZoneSidKey?: string | null
  RecurrenceRegeneratedType?: string | null
  RecurrenceActivityId?: string | null

  // Relationships
  OwnerId?: string | null
  WhoId?: string | null
  WhatId?: string | null
  AccountId?: string | null

  // Computed (read-only)
  CompletedDateTime?: string | null
}

/**
 * Task status picklist values
 */
export type TaskStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Completed'
  | 'Waiting on someone else'
  | 'Deferred'

/**
 * Task priority picklist values
 */
export type TaskPriority =
  | 'High'
  | 'Normal'
  | 'Low'

/**
 * Task type picklist values
 */
export type TaskType =
  | 'Call'
  | 'Email'
  | 'Meeting'
  | 'Other'

/**
 * Task subtype values
 */
export type TaskSubtype =
  | 'Task'
  | 'Email'
  | 'Call'
  | 'ListEmail'
  | 'Cadence'

/**
 * Call type values
 */
export type CallType =
  | 'Inbound'
  | 'Internal'
  | 'Outbound'

/**
 * Recurrence type values
 */
export type RecurrenceType =
  | 'RecursDaily'
  | 'RecursEveryWeekday'
  | 'RecursMonthly'
  | 'RecursMonthlyNth'
  | 'RecursWeekly'
  | 'RecursYearly'
  | 'RecursYearlyNth'

/**
 * Recurrence instance values
 */
export type RecurrenceInstance =
  | 'First'
  | 'Second'
  | 'Third'
  | 'Fourth'
  | 'Last'

/**
 * Recurrence month values
 */
export type RecurrenceMonth =
  | 'January'
  | 'February'
  | 'March'
  | 'April'
  | 'May'
  | 'June'
  | 'July'
  | 'August'
  | 'September'
  | 'October'
  | 'November'
  | 'December'

// =============================================================================
// Event
// =============================================================================

/**
 * Salesforce Event - represents a calendar event or meeting
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_event.htm
 */
export interface Event extends StandardObject {
  // Basic info
  Subject?: string | null
  Description?: string | null
  Location?: string | null

  // Timing
  StartDateTime?: string | null
  EndDateTime?: string | null
  DurationInMinutes?: number | null
  ActivityDateTime?: string | null
  ActivityDate?: string | null
  EndDate?: string | null

  // All-day event
  IsAllDayEvent?: boolean

  // Type and visibility
  Type?: EventType | string | null
  ShowAs?: ShowAs | string | null
  EventSubtype?: EventSubtype | null

  // Flags
  IsPrivate?: boolean
  IsChild?: boolean
  IsGroupEvent?: boolean
  IsArchived?: boolean
  IsRecurrence?: boolean
  IsRecurrence2Exclusion?: boolean
  IsReminderSet?: boolean

  // Reminder
  ReminderDateTime?: string | null

  // Video conference
  IsClientManaged?: boolean

  // Recurrence fields
  RecurrenceStartDateTime?: string | null
  RecurrenceEndDateOnly?: string | null
  RecurrenceType?: RecurrenceType | null
  RecurrenceInterval?: number | null
  RecurrenceDayOfWeekMask?: number | null
  RecurrenceDayOfMonth?: number | null
  RecurrenceInstance?: RecurrenceInstance | null
  RecurrenceMonthOfYear?: RecurrenceMonth | null
  RecurrenceTimeZoneSidKey?: string | null
  RecurrenceActivityId?: string | null
  Recurrence2PatternText?: string | null
  Recurrence2PatternVersion?: string | null
  Recurrence2PatternTimeZone?: string | null
  Recurrence2PatternStartDate?: string | null

  // Relationships
  OwnerId?: string | null
  WhoId?: string | null
  WhatId?: string | null
  AccountId?: string | null

  // Group event
  GroupEventType?: GroupEventType | null
}

/**
 * Event type picklist values
 */
export type EventType =
  | 'Meeting'
  | 'Call'
  | 'Email'
  | 'Other'

/**
 * Event show-as values (for calendar display)
 */
export type ShowAs =
  | 'Busy'
  | 'Free'
  | 'OutOfOffice'

/**
 * Event subtype values
 */
export type EventSubtype =
  | 'Event'
  | 'ResourceAbsence'

/**
 * Group event type values
 */
export type GroupEventType =
  | 'IsChild'
  | 'IsParent'

// =============================================================================
// Campaign
// =============================================================================

/**
 * Salesforce Campaign - represents a marketing campaign
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_campaign.htm
 */
export interface Campaign extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null

  // Type and status
  Type?: CampaignType | string | null
  Status?: CampaignStatus | string | null
  IsActive?: boolean

  // Dates
  StartDate?: string | null
  EndDate?: string | null

  // Budget
  BudgetedCost?: number | null
  ActualCost?: number | null
  ExpectedRevenue?: number | null

  // Response
  ExpectedResponse?: number | null

  // Targeting
  NumberSent?: number | null
  NumberOfLeads?: number | null
  NumberOfConvertedLeads?: number | null
  NumberOfContacts?: number | null
  NumberOfResponses?: number | null
  NumberOfWonOpportunities?: number | null
  NumberOfOpportunities?: number | null

  // Computed values (read-only)
  AmountAllOpportunities?: number | null
  AmountWonOpportunities?: number | null
  HierarchyAmountAllOpportunities?: number | null
  HierarchyAmountWonOpportunities?: number | null
  HierarchyNumberOfLeads?: number | null
  HierarchyNumberOfConvertedLeads?: number | null
  HierarchyNumberOfContacts?: number | null
  HierarchyNumberOfResponses?: number | null
  HierarchyNumberOfOpportunities?: number | null
  HierarchyNumberOfWonOpportunities?: number | null
  HierarchyBudgetedCost?: number | null
  HierarchyActualCost?: number | null
  HierarchyExpectedRevenue?: number | null
  HierarchyNumberSent?: number | null

  // Relationships
  OwnerId?: string | null
  ParentId?: string | null
  CampaignMemberRecordTypeId?: string | null
}

/**
 * Campaign type picklist values
 */
export type CampaignType =
  | 'Conference'
  | 'Webinar'
  | 'Trade Show'
  | 'Public Relations'
  | 'Partners'
  | 'Referral Program'
  | 'Advertisement'
  | 'Banner Ads'
  | 'Direct Mail'
  | 'Email'
  | 'Telemarketing'
  | 'Other'

/**
 * Campaign status picklist values
 */
export type CampaignStatus =
  | 'Planned'
  | 'In Progress'
  | 'Completed'
  | 'Aborted'

// =============================================================================
// CampaignMember
// =============================================================================

/**
 * Salesforce CampaignMember - junction between Campaign and Lead/Contact
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_campaignmember.htm
 */
export interface CampaignMember extends StandardObject {
  // Relationships
  CampaignId: string
  LeadId?: string | null
  ContactId?: string | null

  // Status
  Status?: CampaignMemberStatus | string | null
  HasResponded?: boolean
  FirstRespondedDate?: string | null

  // Lead info (read-only, populated from Lead)
  LeadSource?: LeadSource | string | null
  Name?: string | null
  Title?: string | null
  Company?: string | null
  Street?: string | null
  City?: string | null
  State?: string | null
  PostalCode?: string | null
  Country?: string | null
  Phone?: string | null
  Fax?: string | null
  MobilePhone?: string | null
  Email?: string | null
  DoNotCall?: boolean
  HasOptedOutOfEmail?: boolean
  HasOptedOutOfFax?: boolean

  // Contact info (read-only, populated from Contact)
  Salutation?: Salutation | string | null
  FirstName?: string | null
  LastName?: string | null
  Type?: string | null
}

/**
 * Campaign member status picklist values
 */
export type CampaignMemberStatus =
  | 'Sent'
  | 'Responded'
  | 'Attended'
  | 'Planned'

// =============================================================================
// Product2
// =============================================================================

/**
 * Salesforce Product2 - represents a product that can be sold
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_product2.htm
 */
export interface Product2 extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null
  ProductCode?: string | null

  // Family and classification
  Family?: ProductFamily | string | null

  // Flags
  IsActive?: boolean
  IsArchived?: boolean
  IsDeleted?: boolean

  // Stock keeping
  StockKeepingUnit?: string | null
  QuantityUnitOfMeasure?: string | null

  // Display
  DisplayUrl?: string | null
  ExternalId?: string | null

  // External data
  ExternalDataSourceId?: string | null
}

/**
 * Product family picklist values
 */
export type ProductFamily =
  | 'Hardware'
  | 'Software'
  | 'Services'
  | 'Consulting'
  | 'Support'
  | 'None'

// =============================================================================
// PricebookEntry
// =============================================================================

/**
 * Salesforce PricebookEntry - price book entry for a product
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_pricebookentry.htm
 */
export interface PricebookEntry extends StandardObject {
  // Relationships
  Pricebook2Id: string
  Product2Id: string

  // Pricing
  UnitPrice: number
  UseStandardPrice?: boolean

  // Status
  IsActive?: boolean
  IsArchived?: boolean

  // Computed (from Product2)
  Name?: string | null
  ProductCode?: string | null
}

// =============================================================================
// OpportunityLineItem
// =============================================================================

/**
 * Salesforce OpportunityLineItem - line item on an opportunity
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunitylineitem.htm
 */
export interface OpportunityLineItem extends StandardObject {
  // Relationships
  OpportunityId: string
  PricebookEntryId?: string | null
  Product2Id?: string | null

  // Pricing
  UnitPrice?: number | null
  Quantity: number
  TotalPrice?: number | null
  ListPrice?: number | null
  Discount?: number | null

  // Description
  Name?: string | null
  Description?: string | null
  ServiceDate?: string | null

  // Computed (from Product2)
  ProductCode?: string | null

  // Scheduling
  HasQuantitySchedule?: boolean
  HasRevenueSchedule?: boolean
  HasSchedule?: boolean

  // Sort
  SortOrder?: number | null
}

// =============================================================================
// Contract
// =============================================================================

/**
 * Salesforce Contract - represents a contract with a customer
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contract.htm
 */
export interface Contract extends StandardObject {
  // Basic info
  ContractNumber?: string // Auto-generated (read-only)
  Name?: string | null
  Description?: string | null

  // Status
  Status: ContractStatus | string
  StatusCode?: ContractStatusCode | null

  // Dates
  StartDate?: string | null
  EndDate?: string | null
  ContractTerm?: number | null

  // Activation
  ActivatedById?: string | null
  ActivatedDate?: string | null

  // Address
  BillingStreet?: string | null
  BillingCity?: string | null
  BillingState?: string | null
  BillingPostalCode?: string | null
  BillingCountry?: string | null
  BillingLatitude?: number | null
  BillingLongitude?: number | null
  BillingGeocodeAccuracy?: GeocodeAccuracy | null

  ShippingStreet?: string | null
  ShippingCity?: string | null
  ShippingState?: string | null
  ShippingPostalCode?: string | null
  ShippingCountry?: string | null
  ShippingLatitude?: number | null
  ShippingLongitude?: number | null
  ShippingGeocodeAccuracy?: GeocodeAccuracy | null

  // Approval
  OwnerExpirationNotice?: OwnerExpirationNotice | string | null

  // Special terms
  SpecialTerms?: string | null

  // Relationships
  AccountId: string
  OwnerId?: string | null
  CustomerSignedId?: string | null
  CustomerSignedDate?: string | null
  CustomerSignedTitle?: string | null
  CompanySignedId?: string | null
  CompanySignedDate?: string | null
  Pricebook2Id?: string | null

  // Computed (read-only)
  LastApprovedDate?: string | null
}

/**
 * Contract status picklist values
 */
export type ContractStatus =
  | 'Draft'
  | 'In Approval Process'
  | 'Activated'
  | 'Terminated'
  | 'Expired'

/**
 * Contract status code values (system-controlled)
 */
export type ContractStatusCode =
  | 'Draft'
  | 'InApproval'
  | 'Activated'

/**
 * Owner expiration notice picklist values
 */
export type OwnerExpirationNotice =
  | '15'
  | '30'
  | '45'
  | '60'
  | '90'
  | '120'

// =============================================================================
// User
// =============================================================================

/**
 * Salesforce User - represents a Salesforce user
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_user.htm
 */
export interface User extends StandardObject {
  // Name fields
  FirstName?: string | null
  LastName: string
  MiddleName?: string | null
  Suffix?: string | null
  Name?: string // Compound field (read-only)
  CommunityNickname?: string | null
  Alias?: string

  // Login info
  Username: string
  Email: string
  IsActive?: boolean
  FederationIdentifier?: string | null

  // Contact info
  Phone?: string | null
  MobilePhone?: string | null
  Fax?: string | null
  Extension?: string | null

  // Address
  Street?: string | null
  City?: string | null
  State?: string | null
  PostalCode?: string | null
  Country?: string | null
  Latitude?: number | null
  Longitude?: number | null
  GeocodeAccuracy?: GeocodeAccuracy | null

  // Company info
  Title?: string | null
  Department?: string | null
  Division?: string | null
  CompanyName?: string | null
  AboutMe?: string | null

  // Profile and role
  ProfileId?: string | null
  UserRoleId?: string | null
  UserType?: UserType | null
  UserPermissionsMarketingUser?: boolean
  UserPermissionsOfflineUser?: boolean
  UserPermissionsAvantgoUser?: boolean
  UserPermissionsCallCenterAutoLogin?: boolean
  UserPermissionsSFContentUser?: boolean
  UserPermissionsInteractionUser?: boolean
  UserPermissionsSupportUser?: boolean
  UserPermissionsLiveAgentUser?: boolean

  // Locale settings
  LanguageLocaleKey?: string | null
  LocaleSidKey?: string | null
  TimeZoneSidKey?: string | null
  EmailEncodingKey?: string | null

  // Preferences
  ReceivesInfoEmails?: boolean
  ReceivesAdminInfoEmails?: boolean
  DigestFrequency?: DigestFrequency | null
  DefaultGroupNotificationFrequency?: GroupNotificationFrequency | null

  // Photos
  SmallPhotoUrl?: string | null
  FullPhotoUrl?: string | null
  MediumPhotoUrl?: string | null
  SmallBannerPhotoUrl?: string | null
  MediumBannerPhotoUrl?: string | null
  BannerPhotoUrl?: string | null

  // Delegation
  DelegatedApproverId?: string | null

  // Relationships
  ManagerId?: string | null
  ContactId?: string | null
  AccountId?: string | null
  CallCenterId?: string | null

  // System fields (read-only)
  LastLoginDate?: string | null
  LastPasswordChangeDate?: string | null
  NumberOfFailedLogins?: number | null
  IsProfilePhotoActive?: boolean
  OutOfOfficeMessage?: string | null
}

/**
 * User type values
 */
export type UserType =
  | 'Standard'
  | 'PowerPartner'
  | 'PowerCustomerSuccess'
  | 'CustomerSuccess'
  | 'Guest'
  | 'CspLitePortal'
  | 'CsnOnly'
  | 'SelfService'

/**
 * Digest frequency values
 */
export type DigestFrequency =
  | 'D'
  | 'W'
  | 'N'

/**
 * Group notification frequency values
 */
export type GroupNotificationFrequency =
  | 'P'
  | 'D'
  | 'W'
  | 'N'

// =============================================================================
// Asset
// =============================================================================

/**
 * Salesforce Asset - represents a purchased product
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_asset.htm
 */
export interface Asset extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null
  SerialNumber?: string | null

  // Status
  Status?: AssetStatus | string | null
  Price?: number | null
  Quantity?: number | null

  // Dates
  PurchaseDate?: string | null
  InstallDate?: string | null
  UsageEndDate?: string | null

  // Relationships
  AccountId?: string | null
  ContactId?: string | null
  Product2Id?: string | null
  OwnerId?: string | null
  ParentId?: string | null
  RootAssetId?: string | null

  // Computed (from Product2)
  ProductCode?: string | null
  StockKeepingUnit?: string | null

  // Digital asset
  IsCompetitorProduct?: boolean
  IsInternal?: boolean
  HasLifecycleManagement?: boolean
  CurrentMrr?: number | null
  CurrentLifecycleEndDate?: string | null
  CurrentQuantity?: number | null
  CurrentAmount?: number | null

  // Hierarchy (read-only)
  AssetLevel?: number | null
}

/**
 * Asset status picklist values
 */
export type AssetStatus =
  | 'Purchased'
  | 'Shipped'
  | 'Installed'
  | 'Registered'
  | 'Obsolete'

// =============================================================================
// ContentDocument
// =============================================================================

/**
 * Salesforce ContentDocument - represents a document in Salesforce Files
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contentdocument.htm
 */
export interface ContentDocument extends StandardObject {
  // Basic info (read-only)
  Title?: string | null
  Description?: string | null
  FileType?: string | null
  FileExtension?: string | null
  ContentSize?: number | null

  // Versioning
  LatestPublishedVersionId?: string | null
  PublishStatus?: ContentPublishStatus | null
  SharingOption?: ContentSharingOption | null
  SharingPrivacy?: ContentSharingPrivacy | null

  // Parent
  ParentId?: string | null

  // Flags
  IsArchived?: boolean

  // Relationships
  OwnerId?: string | null
  ArchivedById?: string | null
  ArchivedDate?: string | null

  // Computed (read-only)
  ContentAssetId?: string | null
  ContentModifiedDate?: string | null
}

/**
 * Content publish status values
 */
export type ContentPublishStatus =
  | 'P' // Published
  | 'R' // Restricted

/**
 * Content sharing option values
 */
export type ContentSharingOption =
  | 'A' // Allowed
  | 'R' // Restricted

/**
 * Content sharing privacy values
 */
export type ContentSharingPrivacy =
  | 'N' // None
  | 'P' // Private

// =============================================================================
// Note
// =============================================================================

/**
 * Salesforce Note - represents a text note attached to a record
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_note.htm
 */
export interface Note extends StandardObject {
  // Basic info
  Title: string
  Body?: string | null
  IsPrivate?: boolean

  // Relationships
  OwnerId?: string | null
  ParentId?: string | null
}

// =============================================================================
// Attachment
// =============================================================================

/**
 * Salesforce Attachment - represents a file attached to a record
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_attachment.htm
 */
export interface Attachment extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null
  Body?: string | null
  BodyLength?: number | null
  ContentType?: string | null
  IsPrivate?: boolean

  // Relationships
  OwnerId?: string | null
  ParentId: string
}

// =============================================================================
// RecordType
// =============================================================================

/**
 * Salesforce RecordType - represents a record type for an object
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_recordtype.htm
 */
export interface RecordType extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null
  DeveloperName?: string | null
  NamespacePrefix?: string | null

  // Object reference
  SobjectType: string

  // Status
  IsActive?: boolean
  IsPersonType?: boolean

  // Business process
  BusinessProcessId?: string | null
}

// =============================================================================
// Quote
// =============================================================================

/**
 * Salesforce Quote - represents a quote for products/services
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_quote.htm
 */
export interface Quote extends StandardObject {
  // Basic info
  Name: string
  Description?: string | null
  QuoteNumber?: string // Auto-generated (read-only)

  // Status
  Status: QuoteStatus | string
  IsSyncing?: boolean

  // Dates
  ExpirationDate?: string | null

  // Amounts
  Subtotal?: number | null
  TotalPrice?: number | null
  Discount?: number | null
  Tax?: number | null
  ShippingHandling?: number | null
  GrandTotal?: number | null

  // Address
  BillingStreet?: string | null
  BillingCity?: string | null
  BillingState?: string | null
  BillingPostalCode?: string | null
  BillingCountry?: string | null
  BillingLatitude?: number | null
  BillingLongitude?: number | null
  BillingName?: string | null

  ShippingStreet?: string | null
  ShippingCity?: string | null
  ShippingState?: string | null
  ShippingPostalCode?: string | null
  ShippingCountry?: string | null
  ShippingLatitude?: number | null
  ShippingLongitude?: number | null
  ShippingName?: string | null

  // Additional info
  Phone?: string | null
  Fax?: string | null
  Email?: string | null
  QuoteToStreet?: string | null
  QuoteToCity?: string | null
  QuoteToState?: string | null
  QuoteToPostalCode?: string | null
  QuoteToCountry?: string | null
  QuoteToLatitude?: number | null
  QuoteToLongitude?: number | null
  QuoteToName?: string | null

  // Relationships
  OpportunityId: string
  AccountId?: string | null
  ContactId?: string | null
  Pricebook2Id?: string | null
  OwnerId?: string | null
  ContractId?: string | null

  // Document
  QuoteTemplateId?: string | null
  AdditionalStreet?: string | null
  AdditionalCity?: string | null
  AdditionalState?: string | null
  AdditionalPostalCode?: string | null
  AdditionalCountry?: string | null
  AdditionalLatitude?: number | null
  AdditionalLongitude?: number | null
  AdditionalName?: string | null

  // Line items summary (read-only)
  LineItemCount?: number | null
}

/**
 * Quote status picklist values
 */
export type QuoteStatus =
  | 'Draft'
  | 'Needs Review'
  | 'In Review'
  | 'Approved'
  | 'Rejected'
  | 'Presented'
  | 'Accepted'
  | 'Denied'

// =============================================================================
// QuoteLineItem
// =============================================================================

/**
 * Salesforce QuoteLineItem - line item on a quote
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_quotelineitem.htm
 */
export interface QuoteLineItem extends StandardObject {
  // Relationships
  QuoteId: string
  PricebookEntryId?: string | null
  Product2Id?: string | null

  // Pricing
  UnitPrice?: number | null
  Quantity: number
  TotalPrice?: number | null
  ListPrice?: number | null
  Discount?: number | null
  Subtotal?: number | null

  // Description
  Description?: string | null
  ServiceDate?: string | null

  // Computed (from Product2)
  ProductCode?: string | null

  // Sort
  SortOrder?: number | null

  // Opportunity line item reference
  OpportunityLineItemId?: string | null
}

// =============================================================================
// Order
// =============================================================================

/**
 * Salesforce Order - represents a customer order
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_order.htm
 */
export interface Order extends StandardObject {
  // Basic info
  Name?: string | null
  Description?: string | null
  OrderNumber?: string // Auto-generated (read-only)

  // Status
  Status: OrderStatus | string
  StatusCode?: OrderStatusCode | null
  Type?: OrderType | string | null

  // Dates
  EffectiveDate: string
  EndDate?: string | null
  ActivatedDate?: string | null
  ActivatedById?: string | null

  // Amounts
  TotalAmount?: number | null

  // Customer reference
  PoNumber?: string | null
  OrderReferenceNumber?: string | null
  CustomerAuthorizedById?: string | null
  CustomerAuthorizedDate?: string | null
  CompanyAuthorizedById?: string | null
  CompanyAuthorizedDate?: string | null

  // Address
  BillingStreet?: string | null
  BillingCity?: string | null
  BillingState?: string | null
  BillingPostalCode?: string | null
  BillingCountry?: string | null
  BillingLatitude?: number | null
  BillingLongitude?: number | null
  BillingGeocodeAccuracy?: GeocodeAccuracy | null

  ShippingStreet?: string | null
  ShippingCity?: string | null
  ShippingState?: string | null
  ShippingPostalCode?: string | null
  ShippingCountry?: string | null
  ShippingLatitude?: number | null
  ShippingLongitude?: number | null
  ShippingGeocodeAccuracy?: GeocodeAccuracy | null

  // Relationships
  AccountId: string
  ContractId?: string | null
  OpportunityId?: string | null
  QuoteId?: string | null
  Pricebook2Id?: string | null
  OriginalOrderId?: string | null
  OwnerId?: string | null
  BillToContactId?: string | null
  ShipToContactId?: string | null

  // Flags
  IsReductionOrder?: boolean
}

/**
 * Order status picklist values
 */
export type OrderStatus =
  | 'Draft'
  | 'Activated'
  | 'Cancelled'
  | 'Expired'

/**
 * Order status code values (system-controlled)
 */
export type OrderStatusCode =
  | 'Draft'
  | 'Activated'
  | 'Cancelled'
  | 'Expired'

/**
 * Order type picklist values
 */
export type OrderType =
  | 'New'
  | 'Renewal'
  | 'Upsell'
  | 'Amendment'

// =============================================================================
// OrderItem
// =============================================================================

/**
 * Salesforce OrderItem - line item on an order
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_orderitem.htm
 */
export interface OrderItem extends StandardObject {
  // Relationships
  OrderId: string
  PricebookEntryId?: string | null
  Product2Id?: string | null

  // Pricing
  UnitPrice?: number | null
  Quantity: number
  TotalPrice?: number | null
  ListPrice?: number | null

  // Description
  Description?: string | null
  ServiceDate?: string | null
  EndDate?: string | null

  // Computed (from Product2)
  ProductCode?: string | null

  // References
  OrderItemNumber?: string | null
  OriginalOrderItemId?: string | null
  QuoteLineItemId?: string | null

  // Sort
  AvailableQuantity?: number | null
}

// =============================================================================
// Type Guards / Utility Types
// =============================================================================

/**
 * Type guard to check if an SObject is an Account
 */
export function isAccount(obj: SObject): obj is Account {
  return obj.attributes?.type === 'Account' || 'Name' in obj && !('FirstName' in obj) && !('LastName' in obj)
}

/**
 * Type guard to check if an SObject is a Contact
 */
export function isContact(obj: SObject): obj is Contact {
  return obj.attributes?.type === 'Contact' || ('LastName' in obj && !('Company' in obj) && !('Status' in obj))
}

/**
 * Type guard to check if an SObject is a Lead
 */
export function isLead(obj: SObject): obj is Lead {
  return obj.attributes?.type === 'Lead' || ('LastName' in obj && 'Company' in obj && 'Status' in obj)
}

/**
 * Type guard to check if an SObject is an Opportunity
 */
export function isOpportunity(obj: SObject): obj is Opportunity {
  return obj.attributes?.type === 'Opportunity' || ('StageName' in obj && 'CloseDate' in obj)
}

/**
 * Type guard to check if an SObject is a Case
 */
export function isCase(obj: SObject): obj is Case {
  return obj.attributes?.type === 'Case' || ('CaseNumber' in obj || ('Subject' in obj && 'Status' in obj && !('StageName' in obj)))
}

/**
 * Type guard to check if an SObject is a Task
 */
export function isTask(obj: SObject): obj is Task {
  return obj.attributes?.type === 'Task' || ('Subject' in obj && 'Status' in obj && !('CaseNumber' in obj) && !('StartDateTime' in obj))
}

/**
 * Type guard to check if an SObject is an Event
 */
export function isEvent(obj: SObject): obj is Event {
  return obj.attributes?.type === 'Event' || ('StartDateTime' in obj && 'EndDateTime' in obj)
}

/**
 * Type guard to check if an SObject is a Campaign
 */
export function isCampaign(obj: SObject): obj is Campaign {
  return obj.attributes?.type === 'Campaign' || ('NumberOfLeads' in obj || 'BudgetedCost' in obj)
}

/**
 * Type guard to check if an SObject is a User
 */
export function isUser(obj: SObject): obj is User {
  return obj.attributes?.type === 'User' || ('Username' in obj && 'Email' in obj && 'Alias' in obj)
}

// =============================================================================
// Create Input Types
// =============================================================================

/**
 * Input type for creating an Account
 */
export type AccountCreateInput = Omit<Account, keyof StandardObject | 'attributes'> & { Name: string }

/**
 * Input type for creating a Contact
 */
export type ContactCreateInput = Omit<Contact, keyof StandardObject | 'attributes' | 'Name'> & { LastName: string }

/**
 * Input type for creating a Lead
 */
export type LeadCreateInput = Omit<Lead, keyof StandardObject | 'attributes' | 'Name' | 'IsConverted' | 'ConvertedAccountId' | 'ConvertedContactId' | 'ConvertedOpportunityId' | 'ConvertedDate'> & { LastName: string; Company: string; Status: LeadStatus | string }

/**
 * Input type for creating an Opportunity
 */
export type OpportunityCreateInput = Omit<Opportunity, keyof StandardObject | 'attributes' | 'IsClosed' | 'IsWon' | 'FiscalQuarter' | 'FiscalYear' | 'Fiscal' | 'HasOpportunityLineItem'> & { Name: string; StageName: OpportunityStage | string; CloseDate: string }

/**
 * Input type for creating a Case
 */
export type CaseCreateInput = Omit<Case, keyof StandardObject | 'attributes' | 'CaseNumber' | 'IsClosed'> & { Status: CaseStatus | string }

/**
 * Input type for creating a Task
 */
export type TaskCreateInput = Omit<Task, keyof StandardObject | 'attributes' | 'IsClosed' | 'CompletedDateTime'> & { Status: TaskStatus | string }

/**
 * Input type for creating an Event
 */
export type EventCreateInput = Omit<Event, keyof StandardObject | 'attributes' | 'IsChild' | 'IsGroupEvent'>

/**
 * Input type for creating a Campaign
 */
export type CampaignCreateInput = Omit<Campaign, keyof StandardObject | 'attributes' | 'NumberOfLeads' | 'NumberOfConvertedLeads' | 'NumberOfContacts' | 'NumberOfResponses' | 'NumberOfWonOpportunities' | 'NumberOfOpportunities'> & { Name: string }

/**
 * Input type for creating a Quote
 */
export type QuoteCreateInput = Omit<Quote, keyof StandardObject | 'attributes' | 'QuoteNumber' | 'Subtotal' | 'TotalPrice' | 'GrandTotal' | 'LineItemCount'> & { Name: string; OpportunityId: string }

/**
 * Input type for creating an Order
 */
export type OrderCreateInput = Omit<Order, keyof StandardObject | 'attributes' | 'OrderNumber' | 'StatusCode' | 'TotalAmount'> & { AccountId: string; EffectiveDate: string; Status: OrderStatus | string }
