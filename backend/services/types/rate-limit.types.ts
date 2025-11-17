/**
 * Rate limit record types stored in DynamoDB
 */

/**
 * Hourly rate limit record
 * Tracks geocoding requests within a specific hour
 * Auto-deleted 2 hours after the hour ends via TTL
 */
export interface HourlyRateLimitRecord {
  /** Partition key: "hourly:userId:hourStartTimestamp" */
  id: string;
  
  /** User's Cognito sub claim */
  userId: string;
  
  /** Number of searches this hour (1-20) */
  count: number;
  
  /** Unix timestamp (ms) when the hour ends */
  resetAt: number;
  
  /** Unix timestamp (ms) when first search of the hour happened */
  createdAt: number;
  
  /** Unix timestamp (seconds) for DynamoDB TTL (resetAt + 2 hours) */
  ttl: number;
}

/**
 * Lifetime rate limit record
 * Tracks total geocoding requests for a user (persists forever)
 */
export interface LifetimeRateLimitRecord {
  /** Partition key: "lifetime:userId" */
  id: string;
  
  /** User's Cognito sub claim */
  userId: string;
  
  /** Total searches ever (1-100) */
  count: number;
  
  /** Unix timestamp (ms) when user made their first ever search */
  createdAt: number;
  
  /** Unix timestamp (ms) when user made their most recent search */
  lastUsedAt: number;
}

/**
 * Rate limit check response
 */
export interface RateLimitStatus {
  /** Whether the user can make another request */
  allowed: boolean;
  
  /** Remaining searches this hour */
  hourlyRemaining: number;
  
  /** Remaining searches for lifetime */
  lifetimeRemaining: number;
  
  /** ISO timestamp when hourly limit resets */
  resetAt: string;
  
  /** Optional error message if limit exceeded */
  message?: string;
}

/**
 * Rate limit increment request
 */
export interface IncrementRateLimitRequest {
  /** Optional: if provided, verifies the check was recent */
  checkTimestamp?: number;
}

/**
 * Rate limit increment response
 */
export interface IncrementRateLimitResponse {
  /** Whether the increment was successful */
  success: boolean;
  
  /** Updated rate limit status */
  status: RateLimitStatus;
}


