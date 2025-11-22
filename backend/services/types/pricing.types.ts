/**
 * Pricing Types for Listing Pricing System
 * 
 * Supports:
 * - Base pricing (year-round default)
 * - Seasonal pricing (date-range specific)
 * - Length-of-stay discounts
 * - Members-only pricing
 */

// ============================================================================
// DISCOUNT TYPES
// ============================================================================

export type DiscountType = 'PERCENTAGE' | 'ABSOLUTE';

export interface MembersDiscount {
  type: DiscountType;
  
  // If type=PERCENTAGE:
  percentage?: number;              // 10 (means 10% off)
  
  // If type=ABSOLUTE:
  absolutePrice?: number;           // €90 (user sets exact price)
  
  // Calculated values (always stored)
  calculatedPrice: number;          // Final price after discount
  calculatedPercentage: number;     // Percentage off (calculated if absolute)
}

// ============================================================================
// BASE PRICE (DynamoDB Record)
// ============================================================================

export interface BasePriceRecord {
  // Keys
  pk: string;                       // HOST#{hostId}
  sk: string;                       // LISTING_PRICING#{listingId}#BASE#{basePriceId}
  
  // Identifiers
  listingId: string;
  basePriceId: string;              // "default" or "season_uuid"
  isDefault: boolean;               // true for year-round base price
  
  // Date range (null for default)
  dateRange: {
    startDate: string;              // "2025-06-01" (ISO format)
    endDate: string;                // "2025-08-31" (ISO format)
    displayStart: string;           // "01-06-2025" (European format)
    displayEnd: string;             // "31-08-2025" (European format)
  } | null;
  
  // Standard pricing
  standardPrice: number;            // €150
  
  // Members-only pricing (optional)
  membersDiscount: MembersDiscount | null;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  
  // GSI3: Direct lookup by listingId
  gsi3pk: string;                   // LISTING#{listingId}
  gsi3sk: string;                   // BASE_PRICE#{basePriceId}
}

// ============================================================================
// LENGTH OF STAY DISCOUNT (DynamoDB Record)
// ============================================================================

export interface LengthOfStayRecord {
  // Keys
  pk: string;                       // HOST#{hostId}
  sk: string;                       // LISTING_PRICING#{listingId}#LENGTH_OF_STAY#{losId}
  
  // Identifiers
  listingId: string;
  lengthOfStayId: string;           // "los_uuid"
  
  // Minimum nights threshold
  minNights: number;                // 7, 14, 30, etc.
  
  // Discount configuration
  discountType: DiscountType;
  discountPercentage?: number;      // 5 (if percentage)
  discountAbsolute?: number;        // €10 (if absolute)
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  
  // GSI3: Direct lookup by listingId
  gsi3pk: string;                   // LISTING#{listingId}
  gsi3sk: string;                   // LENGTH_OF_STAY#{losId}
}

// ============================================================================
// PRICING MATRIX (DynamoDB Record - Denormalized)
// ============================================================================

export interface LengthOfStayPricing {
  minNights: number;
  discountType: DiscountType;
  discountValue: number;            // Percentage or absolute amount
  standardPrice: number;            // Calculated price
  membersPrice: number | null;      // Calculated price (if members discount exists)
}

export interface BasePriceWithDiscounts {
  basePriceId: string;
  isDefault: boolean;
  dateRange: {
    startDate: string;              // ISO format
    endDate: string;
    displayStart: string;           // European format
    displayEnd: string;
  } | null;
  
  // Base pricing
  standardPrice: number;
  membersDiscount: {
    type: DiscountType;
    inputValue: number;             // The value user entered
    calculatedPrice: number;        // Final price
    calculatedPercentage: number;   // Always calculated for display
  } | null;
  
  // Length of stay pricing (applied to this base price)
  lengthOfStayPricing: LengthOfStayPricing[];
}

export interface PricingMatrix {
  basePrices: BasePriceWithDiscounts[];
}

export interface PricingMatrixRecord {
  // Keys
  pk: string;                       // HOST#{hostId}
  sk: string;                       // LISTING_PRICING#{listingId}#MATRIX
  
  // Identifiers
  listingId: string;
  currency: string;                 // Inherited from listing
  
  // Full calculated pricing matrix
  matrix: PricingMatrix;
  
  // Tourist tax configuration (optional)
  // Note: Always stored and returned as per-night amounts
  // Frontend can calculate total based on number of nights and guests
  touristTax?: {
    type: 'PER_NIGHT' | 'PER_STAY';  // How the tax is charged (for display purposes)
    adultAmount: number;              // Amount per adult per night
    childAmount: number;              // Amount per child per night
  };
  
  // Metadata
  lastCalculatedAt: string;
  updatedAt: string;
  
  // GSI3: Direct lookup by listingId
  gsi3pk: string;                   // LISTING#{listingId}
  gsi3sk: string;                   // PRICING_MATRIX
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

// Request: Set/Update Pricing
export interface SetPricingRequest {
  currency: string;                   // Required: 3-letter ISO code (EUR, USD, GBP, etc.)
  basePrices: {
    default: {
      standardPrice: number;
      membersDiscount: {
        type: DiscountType;
        percentage?: number;
        absolutePrice?: number;
      } | null;
    };
    seasonal: Array<{
      dateRange: {
        startDate: string;          // European format: "01-06-2025"
        endDate: string;            // European format: "31-08-2025"
      };
      standardPrice: number;
      membersDiscount: {
        type: DiscountType;
        percentage?: number;
        absolutePrice?: number;
      } | null;
    }>;
  };
  lengthOfStayDiscounts: Array<{
    minNights: number;
    discountType: DiscountType;
    discountPercentage?: number;
    discountAbsolute?: number;
  }>;
  touristTax?: {
    type: 'PER_NIGHT' | 'PER_STAY';   // How the tax is charged (for display purposes)
    adultAmount: number;               // Amount per adult per night in listing currency
    childAmount: number;               // Amount per child per night in listing currency
  };
}

// Response: Get/Set Pricing
export interface PricingConfiguration {
  basePrice: {
    standardPrice: number;
    membersDiscount: {
      type: DiscountType;
      percentage?: number;
      absolutePrice?: number;
    } | null;
  };
  seasonalPrices: Array<{
    basePriceId: string;
    dateRange: {
      startDate: string;            // European format
      endDate: string;
    };
    standardPrice: number;
    membersDiscount: {
      type: DiscountType;
      percentage?: number;
      absolutePrice?: number;
    } | null;
  }>;
  lengthOfStayDiscounts: Array<{
    lengthOfStayId: string;
    minNights: number;
    discountType: DiscountType;
    discountPercentage?: number;
    discountAbsolute?: number;
  }>;
  touristTax?: {
    type: 'PER_NIGHT' | 'PER_STAY';  // How the tax is charged (for display purposes)
    adultAmount: number;              // Amount per adult per night
    childAmount: number;              // Amount per child per night
  };
}

export interface GetPricingResponse {
  listingId: string;
  currency: string;
  configuration: PricingConfiguration;
  matrix: PricingMatrix;
  lastUpdatedAt: string;
}

export interface SetPricingResponse {
  listingId: string;
  currency: string;
  configuration: PricingConfiguration;
  matrix: PricingMatrix;
  lastUpdatedAt: string;
}





