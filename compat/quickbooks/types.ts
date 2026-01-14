/**
 * QuickBooks API Type Definitions
 *
 * Comprehensive type definitions for QuickBooks Online API compatibility.
 * Based on the official Intuit QuickBooks Online API.
 *
 * @module @dotdo/quickbooks/types
 */

// =============================================================================
// Common Types
// =============================================================================

export interface Reference {
  value: string
  name?: string
}

export interface MetaData {
  CreateTime: string
  LastUpdatedTime: string
}

export interface Address {
  Id?: string
  Line1?: string
  Line2?: string
  Line3?: string
  Line4?: string
  Line5?: string
  City?: string
  CountrySubDivisionCode?: string
  Country?: string
  PostalCode?: string
  Lat?: string
  Long?: string
}

export interface PhoneNumber {
  FreeFormNumber?: string
}

export interface EmailAddress {
  Address?: string
}

export interface WebAddress {
  URI?: string
}

export interface CurrencyRef {
  value: string
  name?: string
}

export interface LinkedTxn {
  TxnId: string
  TxnType: string
}

export type Metadata = Record<string, string | number | boolean>

// =============================================================================
// Account Types
// =============================================================================

export type AccountType =
  | 'Bank'
  | 'Other Current Asset'
  | 'Fixed Asset'
  | 'Other Asset'
  | 'Accounts Receivable'
  | 'Equity'
  | 'Expense'
  | 'Other Expense'
  | 'Cost of Goods Sold'
  | 'Accounts Payable'
  | 'Credit Card'
  | 'Long Term Liability'
  | 'Other Current Liability'
  | 'Income'
  | 'Other Income'

export type AccountSubType =
  | 'CashOnHand'
  | 'Checking'
  | 'MoneyMarket'
  | 'RentsHeldInTrust'
  | 'Savings'
  | 'TrustAccounts'
  | 'AllowanceForBadDebts'
  | 'DevelopmentCosts'
  | 'EmployeeCashAdvances'
  | 'OtherCurrentAssets'
  | 'Inventory'
  | 'Investment_MortgageRealEstateLoans'
  | 'Investment_Other'
  | 'Investment_TaxExemptSecurities'
  | 'Investment_USGovernmentObligations'
  | 'LoansToOfficers'
  | 'LoansToOthers'
  | 'LoansToStockholders'
  | 'PrepaidExpenses'
  | 'Retainage'
  | 'UndepositedFunds'
  | 'AccumulatedDepletion'
  | 'AccumulatedDepreciation'
  | 'DepletableAssets'
  | 'FurnitureAndFixtures'
  | 'Land'
  | 'LeaseholdImprovements'
  | 'MachineryAndEquipment'
  | 'OtherFixedAssets'
  | 'Vehicles'
  | 'Buildings'
  | 'AssetsAvailableForSale'
  | 'BalWithGovtAuthorities'
  | 'DeferredTax'
  | 'Goodwill'
  | 'IntangibleAssets'
  | 'LicensesAndFranchises'
  | 'OrganizationalCosts'
  | 'OtherAssets'
  | 'SecurityDeposits'
  | 'AccountsReceivable'
  | 'OpeningBalanceEquity'
  | 'PartnersEquity'
  | 'RetainedEarnings'
  | 'AccumulatedAdjustment'
  | 'OwnersEquity'
  | 'PaidInCapitalOrSurplus'
  | 'PartnerContributions'
  | 'PartnerDistributions'
  | 'PreferredStock'
  | 'CommonStock'
  | 'TreasuryStock'
  | 'EstimatedTaxes'
  | 'HealthInsurance'
  | 'PersonalExpense'
  | 'PersonalIncome'
  | 'AdvertisingPromotional'
  | 'BadDebts'
  | 'BankCharges'
  | 'CharitableContributions'
  | 'CommissionsAndFees'
  | 'Entertainment'
  | 'EntertainmentMeals'
  | 'EquipmentRental'
  | 'FinanceCosts'
  | 'GlobalTaxExpense'
  | 'Insurance'
  | 'InterestPaid'
  | 'LegalProfessionalFees'
  | 'OfficeExpenses'
  | 'OtherBusinessExpenses'
  | 'OtherMiscellaneousServiceCost'
  | 'PromotionalMeals'
  | 'RentOrLeaseOfBuildings'
  | 'RepairMaintenance'
  | 'ShippingFreightDelivery'
  | 'Supplies'
  | 'Travel'
  | 'TravelMeals'
  | 'Utilities'
  | 'Auto'
  | 'CostOfLabor'
  | 'DuesSubscriptions'
  | 'PayrollExpenses'
  | 'TaxesPaid'
  | 'UnappliedCashBillPaymentExpense'
  | 'Amortization'
  | 'Depreciation'
  | 'ExchangeGainOrLoss'
  | 'OtherMiscellaneousExpense'
  | 'PenaltiesSettlements'
  | 'EquipmentRentalCos'
  | 'OtherCostsOfServiceCos'
  | 'ShippingFreightDeliveryCos'
  | 'SuppliesMaterialsCogs'
  | 'CostOfLaborCos'
  | 'AccountsPayable'
  | 'CreditCard'
  | 'LineOfCredit'
  | 'LoanPayable'
  | 'NotesPayable'
  | 'OtherLongTermLiabilities'
  | 'ShareholderNotesPayable'
  | 'AccruedLiabilities'
  | 'CurrentPortionOfObligationsUnderCapitalLeases'
  | 'CurrentTaxLiability'
  | 'DividendsPayable'
  | 'CurrentPortionEmployeeBenefitsObligations'
  | 'CurrentMaturitiesOfLongTermDebt'
  | 'DeferredRevenue'
  | 'GlobalTaxPayable'
  | 'GlobalTaxSuspense'
  | 'IncomeTaxPayable'
  | 'OtherCurrentLiabilities'
  | 'PayrollClearing'
  | 'PayrollTaxPayable'
  | 'PrepaidExpensesPayable'
  | 'SalesOfProductIncome'
  | 'ServiceFeeIncome'
  | 'NonProfitIncome'
  | 'OtherPrimaryIncome'
  | 'SalesTaxCollectedPayable'
  | 'TrustAccountsLiabilities'
  | 'DividendIncome'
  | 'InterestEarned'
  | 'OtherInvestmentIncome'
  | 'OtherMiscellaneousIncome'
  | 'TaxExemptInterest'
  | 'UnappliedCashPaymentIncome'
  | 'DiscountsRefundsGiven'
  | 'ReconciledOrUnreconciled'

export type AccountClassification = 'Asset' | 'Equity' | 'Expense' | 'Liability' | 'Revenue'

export interface Account {
  Id: string
  Name: string
  SyncToken: string
  AccountType: AccountType
  AccountSubType?: AccountSubType
  Classification?: AccountClassification
  CurrentBalance?: number
  CurrentBalanceWithSubAccounts?: number
  Active?: boolean
  SubAccount?: boolean
  ParentRef?: Reference
  FullyQualifiedName?: string
  AcctNum?: string
  Description?: string
  TaxCodeRef?: Reference
  CurrencyRef?: CurrencyRef
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface AccountCreateParams {
  Name: string
  AccountType: AccountType
  AccountSubType?: AccountSubType
  AcctNum?: string
  Description?: string
  SubAccount?: boolean
  ParentRef?: Reference
  Active?: boolean
  TaxCodeRef?: Reference
  CurrencyRef?: CurrencyRef
}

export interface AccountUpdateParams extends Partial<AccountCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Customer Types
// =============================================================================

export interface Customer {
  Id: string
  SyncToken: string
  DisplayName: string
  Title?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  CompanyName?: string
  Active?: boolean
  PrimaryPhone?: PhoneNumber
  AlternatePhone?: PhoneNumber
  Mobile?: PhoneNumber
  Fax?: PhoneNumber
  PrimaryEmailAddr?: EmailAddress
  WebAddr?: WebAddress
  DefaultTaxCodeRef?: Reference
  Taxable?: boolean
  TaxExemptionReasonId?: string
  BillAddr?: Address
  ShipAddr?: Address
  Notes?: string
  Job?: boolean
  BillWithParent?: boolean
  ParentRef?: Reference
  Level?: number
  SalesTermRef?: Reference
  PaymentMethodRef?: Reference
  Balance?: number
  BalanceWithJobs?: number
  CurrencyRef?: CurrencyRef
  PreferredDeliveryMethod?: 'Print' | 'Email' | 'None'
  ResaleNum?: string
  ARAccountRef?: Reference
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface CustomerCreateParams {
  DisplayName: string
  Title?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  CompanyName?: string
  Active?: boolean
  PrimaryPhone?: PhoneNumber
  AlternatePhone?: PhoneNumber
  Mobile?: PhoneNumber
  Fax?: PhoneNumber
  PrimaryEmailAddr?: EmailAddress
  WebAddr?: WebAddress
  DefaultTaxCodeRef?: Reference
  Taxable?: boolean
  BillAddr?: Address
  ShipAddr?: Address
  Notes?: string
  Job?: boolean
  BillWithParent?: boolean
  ParentRef?: Reference
  SalesTermRef?: Reference
  PaymentMethodRef?: Reference
  CurrencyRef?: CurrencyRef
  PreferredDeliveryMethod?: 'Print' | 'Email' | 'None'
  ResaleNum?: string
  ARAccountRef?: Reference
}

export interface CustomerUpdateParams extends Partial<CustomerCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Vendor Types
// =============================================================================

export interface Vendor {
  Id: string
  SyncToken: string
  DisplayName: string
  Title?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  CompanyName?: string
  Active?: boolean
  PrimaryPhone?: PhoneNumber
  AlternatePhone?: PhoneNumber
  Mobile?: PhoneNumber
  Fax?: PhoneNumber
  PrimaryEmailAddr?: EmailAddress
  WebAddr?: WebAddress
  Vendor1099?: boolean
  BillAddr?: Address
  OtherAddr?: Address
  TermRef?: Reference
  Balance?: number
  BillRate?: number
  AcctNum?: string
  CurrencyRef?: CurrencyRef
  TaxIdentifier?: string
  APAccountRef?: Reference
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface VendorCreateParams {
  DisplayName: string
  Title?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  CompanyName?: string
  Active?: boolean
  PrimaryPhone?: PhoneNumber
  AlternatePhone?: PhoneNumber
  Mobile?: PhoneNumber
  Fax?: PhoneNumber
  PrimaryEmailAddr?: EmailAddress
  WebAddr?: WebAddress
  Vendor1099?: boolean
  BillAddr?: Address
  OtherAddr?: Address
  TermRef?: Reference
  BillRate?: number
  AcctNum?: string
  CurrencyRef?: CurrencyRef
  TaxIdentifier?: string
  APAccountRef?: Reference
}

export interface VendorUpdateParams extends Partial<VendorCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Invoice Types
// =============================================================================

export interface InvoiceLine {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: 'SalesItemLineDetail' | 'GroupLineDetail' | 'DescriptionOnly' | 'DiscountLineDetail' | 'SubTotalLineDetail'
  SalesItemLineDetail?: {
    ItemRef: Reference
    ClassRef?: Reference
    UnitPrice?: number
    Qty?: number
    TaxCodeRef?: Reference
    ServiceDate?: string
    TaxInclusiveAmt?: number
    DiscountRate?: number
    DiscountAmt?: number
  }
  GroupLineDetail?: {
    GroupItemRef: Reference
    Quantity?: number
    Line?: InvoiceLine[]
  }
  DiscountLineDetail?: {
    DiscountPercent?: number
    PercentBased?: boolean
    DiscountAccountRef?: Reference
  }
  SubTotalLineDetail?: Record<string, unknown>
}

export interface Invoice {
  Id: string
  SyncToken: string
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  Line: InvoiceLine[]
  CustomerRef: Reference
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  TotalAmt?: number
  Balance?: number
  PrivateNote?: string
  CustomerMemo?: { value: string }
  BillAddr?: Address
  ShipAddr?: Address
  ShipFromAddr?: Address
  FreeFormAddress?: boolean
  ShipDate?: string
  ShipMethodRef?: Reference
  TrackingNum?: string
  PrintStatus?: 'NotSet' | 'NeedToPrint' | 'PrintComplete'
  EmailStatus?: 'NotSet' | 'NeedToSend' | 'EmailSent'
  BillEmail?: EmailAddress
  BillEmailCc?: EmailAddress
  BillEmailBcc?: EmailAddress
  DeliveryInfo?: {
    DeliveryType?: string
    DeliveryTime?: string
  }
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
  TxnTaxDetail?: {
    TxnTaxCodeRef?: Reference
    TotalTax?: number
    TaxLine?: Array<{
      Amount: number
      DetailType: string
      TaxLineDetail?: {
        TaxRateRef?: Reference
        PercentBased?: boolean
        TaxPercent?: number
        NetAmountTaxable?: number
      }
    }>
  }
  ApplyTaxAfterDiscount?: boolean
  DepositToAccountRef?: Reference
  Deposit?: number
  SalesTermRef?: Reference
  AllowIPNPayment?: boolean
  AllowOnlinePayment?: boolean
  AllowOnlineCreditCardPayment?: boolean
  AllowOnlineACHPayment?: boolean
  CustomField?: Array<{
    DefinitionId: string
    StringValue?: string
    Name?: string
    Type?: string
  }>
  ClassRef?: Reference
  HomeTotalAmt?: number
  HomeBalance?: number
  RecurDataRef?: Reference
  TaxExemptionRef?: Reference
  LinkedTxn?: LinkedTxn[]
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface InvoiceCreateParams {
  Line: InvoiceLine[]
  CustomerRef: Reference
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  PrivateNote?: string
  CustomerMemo?: { value: string }
  BillAddr?: Address
  ShipAddr?: Address
  ShipDate?: string
  ShipMethodRef?: Reference
  TrackingNum?: string
  PrintStatus?: 'NotSet' | 'NeedToPrint' | 'PrintComplete'
  EmailStatus?: 'NotSet' | 'NeedToSend' | 'EmailSent'
  BillEmail?: EmailAddress
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
  TxnTaxDetail?: Invoice['TxnTaxDetail']
  ApplyTaxAfterDiscount?: boolean
  DepositToAccountRef?: Reference
  Deposit?: number
  SalesTermRef?: Reference
  AllowIPNPayment?: boolean
  AllowOnlinePayment?: boolean
  ClassRef?: Reference
  CustomField?: Invoice['CustomField']
}

export interface InvoiceUpdateParams extends Partial<InvoiceCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Bill Types
// =============================================================================

export interface BillLine {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: 'AccountBasedExpenseLineDetail' | 'ItemBasedExpenseLineDetail'
  AccountBasedExpenseLineDetail?: {
    AccountRef: Reference
    ClassRef?: Reference
    TaxCodeRef?: Reference
    TaxInclusiveAmt?: number
    BillableStatus?: 'Billable' | 'NotBillable' | 'HasBeenBilled'
    CustomerRef?: Reference
  }
  ItemBasedExpenseLineDetail?: {
    ItemRef: Reference
    ClassRef?: Reference
    UnitPrice?: number
    Qty?: number
    TaxCodeRef?: Reference
    TaxInclusiveAmt?: number
    BillableStatus?: 'Billable' | 'NotBillable' | 'HasBeenBilled'
    CustomerRef?: Reference
  }
}

export interface Bill {
  Id: string
  SyncToken: string
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  Line: BillLine[]
  VendorRef: Reference
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  TotalAmt?: number
  Balance?: number
  PrivateNote?: string
  VendorAddr?: Address
  APAccountRef?: Reference
  SalesTermRef?: Reference
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
  TxnTaxDetail?: Invoice['TxnTaxDetail']
  DepartmentRef?: Reference
  LinkedTxn?: LinkedTxn[]
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface BillCreateParams {
  Line: BillLine[]
  VendorRef: Reference
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  PrivateNote?: string
  VendorAddr?: Address
  APAccountRef?: Reference
  SalesTermRef?: Reference
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
  TxnTaxDetail?: Bill['TxnTaxDetail']
  DepartmentRef?: Reference
}

export interface BillUpdateParams extends Partial<BillCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Payment Types
// =============================================================================

export interface PaymentLine {
  Amount: number
  LinkedTxn: LinkedTxn[]
}

export interface Payment {
  Id: string
  SyncToken: string
  TxnDate?: string
  CustomerRef: Reference
  DepositToAccountRef?: Reference
  TotalAmt?: number
  UnappliedAmt?: number
  ProcessPayment?: boolean
  PaymentMethodRef?: Reference
  PaymentRefNum?: string
  PrivateNote?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  Line?: PaymentLine[]
  ARAccountRef?: Reference
  CreditCardPayment?: {
    CreditChargeInfo?: {
      Number?: string
      Type?: string
      NameOnAcct?: string
      CcExpiryMonth?: number
      CcExpiryYear?: number
      BillAddrStreet?: string
      PostalCode?: string
      Amount?: number
    }
    CreditChargeResponse?: {
      Status?: string
      AuthCode?: string
      TxnAuthorizationTime?: string
      CCTransId?: string
    }
  }
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface PaymentCreateParams {
  CustomerRef: Reference
  TxnDate?: string
  DepositToAccountRef?: Reference
  TotalAmt?: number
  ProcessPayment?: boolean
  PaymentMethodRef?: Reference
  PaymentRefNum?: string
  PrivateNote?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  Line?: PaymentLine[]
  ARAccountRef?: Reference
}

export interface PaymentUpdateParams extends Partial<PaymentCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Bill Payment Types
// =============================================================================

export interface BillPaymentLine {
  Amount: number
  LinkedTxn: LinkedTxn[]
}

export interface BillPayment {
  Id: string
  SyncToken: string
  PayType: 'Check' | 'CreditCard'
  TxnDate?: string
  VendorRef: Reference
  TotalAmt?: number
  PrivateNote?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  Line: BillPaymentLine[]
  APAccountRef?: Reference
  CheckPayment?: {
    BankAccountRef: Reference
    PrintStatus?: 'NotSet' | 'NeedToPrint' | 'PrintComplete'
  }
  CreditCardPayment?: {
    CCAccountRef: Reference
  }
  DepartmentRef?: Reference
  ProcessBillPayment?: boolean
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface BillPaymentCreateParams {
  PayType: 'Check' | 'CreditCard'
  VendorRef: Reference
  Line: BillPaymentLine[]
  TxnDate?: string
  TotalAmt?: number
  PrivateNote?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  APAccountRef?: Reference
  CheckPayment?: BillPayment['CheckPayment']
  CreditCardPayment?: BillPayment['CreditCardPayment']
  DepartmentRef?: Reference
  ProcessBillPayment?: boolean
}

export interface BillPaymentUpdateParams extends Partial<BillPaymentCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Journal Entry Types
// =============================================================================

export interface JournalEntryLine {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: 'JournalEntryLineDetail'
  JournalEntryLineDetail: {
    PostingType: 'Debit' | 'Credit'
    AccountRef: Reference
    ClassRef?: Reference
    DepartmentRef?: Reference
    TaxCodeRef?: Reference
    TaxApplicableOn?: 'Sales' | 'Purchase'
    TaxAmount?: number
    BillableStatus?: 'Billable' | 'NotBillable' | 'HasBeenBilled'
    Entity?: {
      Type: 'Customer' | 'Vendor' | 'Employee'
      EntityRef: Reference
    }
  }
}

export interface JournalEntry {
  Id: string
  SyncToken: string
  DocNumber?: string
  TxnDate?: string
  Line: JournalEntryLine[]
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  TotalAmt?: number
  PrivateNote?: string
  Adjustment?: boolean
  HomeTotalAmt?: number
  TxnTaxDetail?: Invoice['TxnTaxDetail']
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface JournalEntryCreateParams {
  Line: JournalEntryLine[]
  DocNumber?: string
  TxnDate?: string
  CurrencyRef?: CurrencyRef
  ExchangeRate?: number
  PrivateNote?: string
  Adjustment?: boolean
  TxnTaxDetail?: JournalEntry['TxnTaxDetail']
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
}

export interface JournalEntryUpdateParams extends Partial<JournalEntryCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Item Types
// =============================================================================

export type ItemType =
  | 'Inventory'
  | 'Service'
  | 'NonInventory'
  | 'Category'
  | 'Bundle'
  | 'Group'
  | 'FixedAsset'
  | 'Payment'
  | 'Discount'
  | 'Tax'
  | 'TaxGroup'

export interface Item {
  Id: string
  SyncToken: string
  Name: string
  Type: ItemType
  Description?: string
  Active?: boolean
  Taxable?: boolean
  UnitPrice?: number
  PurchaseCost?: number
  PurchaseDesc?: string
  QtyOnHand?: number
  InvStartDate?: string
  TrackQtyOnHand?: boolean
  IncomeAccountRef?: Reference
  ExpenseAccountRef?: Reference
  AssetAccountRef?: Reference
  ParentRef?: Reference
  SubItem?: boolean
  Level?: number
  FullyQualifiedName?: string
  SKU?: string
  TaxClassificationRef?: Reference
  SalesTaxCodeRef?: Reference
  SalesTaxIncluded?: boolean
  PurchaseTaxCodeRef?: Reference
  PurchaseTaxIncluded?: boolean
  AbatementRate?: number
  ReverseChargeRate?: number
  ServiceType?: string
  PrintGroupedItems?: boolean
  ItemCategoryType?: 'Product' | 'Service'
  sparse?: boolean
  domain?: string
  MetaData?: MetaData
}

export interface ItemCreateParams {
  Name: string
  Type: ItemType
  Description?: string
  Active?: boolean
  Taxable?: boolean
  UnitPrice?: number
  PurchaseCost?: number
  PurchaseDesc?: string
  QtyOnHand?: number
  InvStartDate?: string
  TrackQtyOnHand?: boolean
  IncomeAccountRef?: Reference
  ExpenseAccountRef?: Reference
  AssetAccountRef?: Reference
  ParentRef?: Reference
  SubItem?: boolean
  SKU?: string
  TaxClassificationRef?: Reference
  SalesTaxCodeRef?: Reference
  PurchaseTaxCodeRef?: Reference
}

export interface ItemUpdateParams extends Partial<ItemCreateParams> {
  Id: string
  SyncToken: string
}

// =============================================================================
// Report Types
// =============================================================================

export interface ReportColumn {
  ColTitle?: string
  ColType?: string
}

export interface ReportRow {
  Header?: {
    ColData: Array<{ value: string; id?: string }>
  }
  Rows?: {
    Row: ReportRow[]
  }
  Summary?: {
    ColData: Array<{ value: string }>
  }
  ColData?: Array<{ value: string; id?: string }>
  type?: string
  group?: string
}

export interface Report {
  Header?: {
    Time?: string
    ReportName?: string
    ReportBasis?: 'Accrual' | 'Cash'
    StartPeriod?: string
    EndPeriod?: string
    SummarizeColumnsBy?: string
    Currency?: string
    Customer?: string
    Vendor?: string
    Employee?: string
    Option?: Array<{ Name: string; Value: string }>
  }
  Columns?: {
    Column: ReportColumn[]
  }
  Rows?: {
    Row: ReportRow[]
  }
}

export interface ReportQueryParams {
  start_date?: string
  end_date?: string
  accounting_method?: 'Accrual' | 'Cash'
  date_macro?: string
  summarize_column_by?: 'Total' | 'Month' | 'Week' | 'Days' | 'Quarter' | 'Year' | 'Customers' | 'Vendors' | 'Classes' | 'Departments' | 'Employees' | 'ProductsAndServices'
  customer?: string
  vendor?: string
  item?: string
  department?: string
  class?: string
  columns?: string
  sort_by?: string
  sort_order?: 'ascend' | 'descend'
  minorversion?: number
}

// =============================================================================
// Query Response Types
// =============================================================================

export interface QueryResponse<T> {
  QueryResponse: {
    [key: string]: T[] | number | undefined
    startPosition?: number
    maxResults?: number
    totalCount?: number
  }
  time: string
}

export interface BatchItemRequest {
  bId: string
  operation: 'create' | 'update' | 'delete' | 'query'
  [key: string]: unknown
}

export interface BatchItemResponse {
  bId: string
  [key: string]: unknown
}

export interface BatchResponse {
  BatchItemResponse: BatchItemResponse[]
  time: string
}

// =============================================================================
// Error Types
// =============================================================================

export interface QuickBooksError {
  Message: string
  Detail?: string
  code?: string
  element?: string
}

export interface QuickBooksFault {
  Error: QuickBooksError[]
  type?: string
}

export interface QuickBooksErrorResponse {
  Fault: QuickBooksFault
  time: string
}

// =============================================================================
// Company Info Types
// =============================================================================

export interface CompanyInfo {
  Id: string
  SyncToken: string
  CompanyName: string
  LegalName?: string
  CompanyAddr?: Address
  CustomerCommunicationAddr?: Address
  LegalAddr?: Address
  PrimaryPhone?: PhoneNumber
  CompanyStartDate?: string
  FiscalYearStartMonth?: string
  Country?: string
  Email?: EmailAddress
  WebAddr?: WebAddress
  SupportedLanguages?: string
  NameValue?: Array<{ Name: string; Value: string }>
  domain?: string
  sparse?: boolean
  MetaData?: MetaData
}

// =============================================================================
// Preferences Types
// =============================================================================

export interface Preferences {
  Id: string
  SyncToken: string
  AccountingInfoPrefs?: {
    TrackDepartments?: boolean
    DepartmentTerminology?: string
    ClassTrackingPerTxn?: boolean
    ClassTrackingPerTxnLine?: boolean
    CustomerTerminology?: string
    FirstMonthOfFiscalYear?: string
    TaxYearMonth?: string
    BookCloseDate?: string
  }
  ProductAndServicesPrefs?: {
    ForSales?: boolean
    ForPurchase?: boolean
    QuantityWithPriceAndRate?: boolean
    QuantityOnHand?: boolean
  }
  SalesFormsPrefs?: {
    SalesEmailSub?: string
    SalesEmailCc?: string
    SalesEmailBcc?: string
    AllowDeposit?: boolean
    AllowDiscount?: boolean
    AllowEstimates?: boolean
    ETransactionEnabledStatus?: string
    ETransactionPaymentEnabled?: boolean
    IPNSupportEnabled?: boolean
    AllowServiceDate?: boolean
    AllowShipping?: boolean
    CustomTxnNumbers?: boolean
    DefaultTerms?: Reference
    DefaultDiscountAccount?: Reference
    DefaultShippingAccount?: Reference
    CustomField?: Array<{
      CustomFieldDefinitionId?: string
      Name?: string
      Type?: string
      StringValue?: string
    }>
  }
  VendorAndPurchasesPrefs?: {
    BillableExpenseTracking?: boolean
    DefaultTerms?: Reference
    DefaultMarkup?: number
    POCustomField?: Array<{
      CustomFieldDefinitionId?: string
      Name?: string
      Type?: string
      StringValue?: string
    }>
  }
  TimeTrackingPrefs?: {
    UseServices?: boolean
    BillCustomers?: boolean
    ShowBillRateToAll?: boolean
    WorkWeekStartDate?: string
    MarkTimeEntriesBillable?: boolean
  }
  TaxPrefs?: {
    UsingSalesTax?: boolean
    TaxGroupCodeRef?: Reference
  }
  CurrencyPrefs?: {
    MultiCurrencyEnabled?: boolean
    HomeCurrency?: CurrencyRef
  }
  ReportPrefs?: {
    ReportBasis?: 'Accrual' | 'Cash'
    CalcAgingReportFromTxnDate?: boolean
  }
  OtherPrefs?: {
    NameValue?: Array<{ Name: string; Value: string }>
  }
  domain?: string
  sparse?: boolean
  MetaData?: MetaData
}

// =============================================================================
// Webhook Types
// =============================================================================

export interface WebhookNotification {
  realmId: string
  name: string
  id: string
  operation: 'Create' | 'Update' | 'Delete' | 'Merge' | 'Void' | 'Emailed'
  lastUpdated: string
}

export interface WebhookEvent {
  eventNotifications: Array<{
    realmId: string
    dataChangeEvent: {
      entities: WebhookNotification[]
    }
  }>
}

// =============================================================================
// OAuth Types
// =============================================================================

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  x_refresh_token_expires_in: number
  realmId?: string
}

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  environment?: 'sandbox' | 'production'
}
