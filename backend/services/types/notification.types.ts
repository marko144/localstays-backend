/**
 * Push Notification Types
 * 
 * Types for Web Push notifications using VAPID authentication.
 * Subscriptions are tied to Cognito users (not hosts) to support
 * notifications for admins, hosts, and future guest users.
 */

// ============================================================================
// PUSH SUBSCRIPTION (DynamoDB Record)
// ============================================================================

export type DeviceType = 'desktop' | 'mobile' | 'tablet';
export type Platform = 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Other';

/**
 * Push subscription record stored in DynamoDB
 * Tied to USER (Cognito sub), not HOST
 */
export interface PushSubscription {
  // Primary Keys
  pk: string;                           // USER#{cognitoSub}
  sk: string;                           // PUSH_SUB#{subscriptionId}
  
  // Identifiers
  subscriptionId: string;               // sub_<uuid>
  userId: string;                       // Cognito sub (from JWT)
  
  // Push Subscription Data (from browser's PushSubscription API)
  endpoint: string;                     // Push service endpoint URL
  keys: {
    p256dh: string;                     // Public key for encryption
    auth: string;                       // Auth secret
  };
  expirationTime: number | null;        // Optional, from browser subscription
  
  // Device Information
  deviceType: DeviceType;
  userAgent: string;                    // Full user agent string
  platform: Platform;                   // Parsed browser name
  
  // Status & Health Tracking
  isActive: boolean;                    // true = can receive notifications
  lastUsedAt: string;                   // ISO timestamp of last successful send
  failureCount: number;                 // 0-10 (deactivate at 10)
  lastFailureAt: string | null;         // ISO timestamp of last failure
  lastFailureReason: string | null;     // Error message from last failure
  
  // GSI5 - PushSubscriptionIndex
  gsi5pk: string;                       // "PUSH_SUB_ACTIVE" or "PUSH_SUB_INACTIVE"
  gsi5sk: string;                       // createdAt (for sorting)
  
  // Metadata
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;                    // ISO timestamp
  updatedAt: string;                    // ISO timestamp
  
  // TTL - Auto-delete after 1 year of inactivity
  expiresAt: number;                    // Unix timestamp (updated on successful send)
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request body for subscribing to push notifications
 * POST /api/v1/notifications/subscribe
 */
export interface SubscribeRequest {
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
    expirationTime?: number | null;
  };
  deviceType?: DeviceType;              // Optional, will be inferred if not provided
}

/**
 * Response from subscribe endpoint
 */
export interface SubscribeResponse {
  success: boolean;
  subscriptionId: string;
  message?: string;
}

/**
 * Response from list subscriptions endpoint
 * GET /api/v1/notifications/subscriptions
 */
export interface ListSubscriptionsResponse {
  success: boolean;
  subscriptions: {
    subscriptionId: string;
    deviceType: DeviceType;
    platform: Platform;
    isActive: boolean;
    createdAt: string;
    lastUsedAt: string;
  }[];
}

/**
 * Response from unsubscribe endpoint
 * DELETE /api/v1/notifications/subscribe/{subscriptionId}
 */
export interface UnsubscribeResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// NOTIFICATION PAYLOAD TYPES
// ============================================================================

/**
 * Notification action button
 */
export interface NotificationAction {
  action: string;                       // Action ID (e.g., "view", "dismiss")
  title: string;                        // Button text
  icon?: string;                        // Optional icon URL
}

/**
 * Notification payload sent to browser
 * Follows Web Notification API spec
 */
export interface NotificationPayload {
  title: string;                        // Required
  body: string;                         // Notification text
  icon?: string;                        // Icon URL (e.g., "/icon-192x192.png")
  badge?: string;                       // Badge URL (e.g., "/badge-72x72.png")
  image?: string;                       // Large image URL
  data?: {                              // Custom data
    url?: string;                       // URL to open on click
    [key: string]: any;
  };
  actions?: NotificationAction[];       // Action buttons
  tag?: string;                         // Notification tag (for grouping/replacing)
  requireInteraction?: boolean;         // Don't auto-dismiss
  silent?: boolean;                     // No sound/vibration
}

/**
 * Request body for sending notifications (admin only)
 * POST /api/v1/admin/notifications/send
 */
export interface SendNotificationRequest {
  targetType: 'user' | 'all' | 'role';  // Who to send to
  targetIds?: string[];                 // User IDs (if targetType = 'user')
  targetRole?: 'HOST' | 'ADMIN';        // Role (if targetType = 'role')
  notification: NotificationPayload;
}

/**
 * Response from send notification endpoint
 */
export interface SendNotificationResponse {
  success: boolean;
  sent: number;                         // Number of successful sends
  failed: number;                       // Number of failed sends
  deactivated: number;                  // Number of subscriptions deactivated
  errors?: {
    subscriptionId: string;
    error: string;
  }[];
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Result of sending a notification to a single subscription
 */
export interface SendResult {
  subscriptionId: string;
  success: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * VAPID configuration (from SSM Parameter Store)
 */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;                      // mailto:notifications@localstays.com
}

// ============================================================================
// NOTIFICATION TEMPLATES (DynamoDB)
// ============================================================================

/**
 * Notification template stored in DynamoDB
 * Similar to email templates but for push notifications
 */
export interface NotificationTemplate {
  // Primary Keys
  pk: string;                           // NOTIFICATION_TEMPLATE#{templateName}
  sk: string;                           // LANG#{language}
  
  // Template Identification
  templateName: string;                 // e.g., "LISTING_APPROVED", "HOST_APPROVED"
  language: string;                     // ISO 639-1 code (sr, en)
  
  // Notification Content (supports {{variable}} placeholders)
  title: string;                        // Notification title
  body: string;                         // Notification body text
  
  // Notification Display Options
  icon?: string;                        // Icon URL (e.g., "/icon-192x192.png")
  badge?: string;                       // Badge URL (e.g., "/badge-72x72.png")
  image?: string;                       // Large image URL
  
  // Notification Behavior
  actionUrlPath?: string;               // Deep link path (e.g., "/listings/{{listingId}}")
  requireInteraction?: boolean;         // Don't auto-dismiss
  silent?: boolean;                     // No sound/vibration
  tag?: string;                         // Notification tag for grouping
  
  // Metadata
  createdAt: string;                    // ISO timestamp
  updatedAt: string;                    // ISO timestamp
  createdBy?: string;                   // Admin user who created it
  notes?: string;                       // Admin notes about the template
}

/**
 * Template name enum for type safety
 */
export type NotificationTemplateName = 
  | 'LISTING_APPROVED'
  | 'LISTING_PUBLISHED'
  | 'LISTING_REJECTED'
  | 'HOST_APPROVED'
  | 'HOST_REJECTED'
  | 'VIDEO_VERIFICATION_REQUESTED'
  | 'BOOKING_RECEIVED'
  | 'REVIEW_RECEIVED'
  // Subscription & Slot notifications
  | 'ADS_EXPIRING_SOON'
  | 'ADS_EXPIRED'
  | 'PAYMENT_FAILED';

/**
 * Variables that can be used in notification templates
 */
export interface NotificationTemplateVariables {
  [key: string]: string;
  // Common variables:
  // - listingName
  // - listingId
  // - hostName
  // - reason
  // - requestType
}

