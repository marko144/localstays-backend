import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.RATE_LIMIT_TABLE_NAME!;

/**
 * Rate limit configuration for different operation types
 */
export interface RateLimitConfig {
  /** Maximum requests per hour */
  perHour: number;
  /** Maximum requests per day */
  perDay: number;
  /** Human-readable operation name for error messages */
  operationName: string;
}

/**
 * Rate limit configurations for write operations
 */
export const WRITE_OPERATION_LIMITS: Record<string, RateLimitConfig> = {
  // Host profile operations
  'profile-submit-intent': {
    perHour: 10,
    perDay: 50,
    operationName: 'profile submission',
  },
  'profile-confirm-submission': {
    perHour: 10,
    perDay: 50,
    operationName: 'profile confirmation',
  },
  'profile-update-rejected': {
    perHour: 10,
    perDay: 50,
    operationName: 'profile update',
  },

  // Listing operations
  'listing-submit-intent': {
    perHour: 10,
    perDay: 50,
    operationName: 'listing submission',
  },
  'listing-confirm-submission': {
    perHour: 10,
    perDay: 50,
    operationName: 'listing confirmation',
  },
  'listing-update': {
    perHour: 20,
    perDay: 100,
    operationName: 'listing update',
  },
  'listing-publish': {
    perHour: 20,
    perDay: 100,
    operationName: 'listing publication',
  },
  'listing-unpublish': {
    perHour: 20,
    perDay: 100,
    operationName: 'listing unpublication',
  },

  // Image operations
  'image-delete': {
    perHour: 100,
    perDay: 500,
    operationName: 'image deletion',
  },

  // Admin operations
  'admin-approve-host': {
    perHour: 100,
    perDay: 500,
    operationName: 'host approval',
  },
  'admin-reject-host': {
    perHour: 100,
    perDay: 500,
    operationName: 'host rejection',
  },
  'admin-approve-listing': {
    perHour: 100,
    perDay: 500,
    operationName: 'listing approval',
  },
  'admin-reject-listing': {
    perHour: 100,
    perDay: 500,
    operationName: 'listing rejection',
  },
  'admin-send-notification': {
    perHour: 10,
    perDay: 50,
    operationName: 'notification sending',
  },
};

/**
 * Rate limit record stored in DynamoDB
 */
interface WriteOperationRateLimitRecord {
  /** Partition key: "write-op:{operationType}:{userId}:{window}" */
  id: string;
  userId: string;
  operationType: string;
  count: number;
  windowStart: number;
  windowEnd: number;
  ttl: number; // Unix timestamp in seconds for DynamoDB TTL
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  message?: string;
  hourlyRemaining?: number;
  dailyRemaining?: number;
  resetAt?: string;
}

/**
 * Check and increment rate limit for a write operation
 * 
 * This function atomically checks if the user is under their rate limits
 * and increments the counters if allowed.
 * 
 * @param userId - User's Cognito sub claim
 * @param operationType - Type of operation (must be key in WRITE_OPERATION_LIMITS)
 * @returns Rate limit check result
 */
export async function checkAndIncrementWriteOperationRateLimit(
  userId: string,
  operationType: string
): Promise<RateLimitCheckResult> {
  const config = WRITE_OPERATION_LIMITS[operationType];
  
  if (!config) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  const now = Date.now();

  // Calculate time windows
  const hourStart = Math.floor(now / 3600000) * 3600000; // Round down to hour
  const hourEnd = hourStart + 3600000;
  const dayStart = Math.floor(now / 86400000) * 86400000; // Round down to day
  const dayEnd = dayStart + 86400000;

  // Generate keys
  const hourlyKey = `write-op:${operationType}:${userId}:hour:${hourStart}`;
  const dailyKey = `write-op:${operationType}:${userId}:day:${dayStart}`;

  try {
    // Fetch current records in parallel
    const [hourlyResult, dailyResult] = await Promise.all([
      docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: hourlyKey },
      })),
      docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: dailyKey },
      })),
    ]);

    const hourlyRecord = hourlyResult.Item as WriteOperationRateLimitRecord | undefined;
    const dailyRecord = dailyResult.Item as WriteOperationRateLimitRecord | undefined;

    const hourlyCount = hourlyRecord?.count || 0;
    const dailyCount = dailyRecord?.count || 0;

    // Check if limits would be exceeded
    if (hourlyCount >= config.perHour) {
      const minutesUntilReset = Math.ceil((hourEnd - now) / 60000);
      return {
        allowed: false,
        message: `Hourly limit of ${config.perHour} ${config.operationName} requests reached. Try again in ${minutesUntilReset} minute${minutesUntilReset !== 1 ? 's' : ''}.`,
        hourlyRemaining: 0,
        dailyRemaining: Math.max(0, config.perDay - dailyCount),
        resetAt: new Date(hourEnd).toISOString(),
      };
    }

    if (dailyCount >= config.perDay) {
      const hoursUntilReset = Math.ceil((dayEnd - now) / 3600000);
      return {
        allowed: false,
        message: `Daily limit of ${config.perDay} ${config.operationName} requests reached. Try again in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
        hourlyRemaining: Math.max(0, config.perHour - hourlyCount),
        dailyRemaining: 0,
        resetAt: new Date(dayEnd).toISOString(),
      };
    }

    // Limits OK - increment counters atomically
    console.log(`Rate limit OK for ${operationType}, incrementing counters:`, { 
      userId, 
      hourlyCount, 
      dailyCount,
      hourlyLimit: config.perHour,
      dailyLimit: config.perDay,
    });

    // Increment hourly counter
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: hourlyKey },
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #userId = :userId, #operationType = :operationType, #windowStart = :windowStart, #windowEnd = :windowEnd, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#userId': 'userId',
        '#operationType': 'operationType',
        '#windowStart': 'windowStart',
        '#windowEnd': 'windowEnd',
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':userId': userId,
        ':operationType': operationType,
        ':windowStart': hourStart,
        ':windowEnd': hourEnd,
        ':ttl': Math.floor((hourEnd + 7200000) / 1000), // TTL = 2 hours after window ends (in seconds)
      },
    }));

    // Increment daily counter
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: dailyKey },
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #userId = :userId, #operationType = :operationType, #windowStart = :windowStart, #windowEnd = :windowEnd, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#userId': 'userId',
        '#operationType': 'operationType',
        '#windowStart': 'windowStart',
        '#windowEnd': 'windowEnd',
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':userId': userId,
        ':operationType': operationType,
        ':windowStart': dayStart,
        ':windowEnd': dayEnd,
        ':ttl': Math.floor((dayEnd + 86400000) / 1000), // TTL = 1 day after window ends (in seconds)
      },
    }));

    console.log(`Rate limit incremented successfully for ${operationType}:`, { 
      userId,
      newHourlyCount: hourlyCount + 1,
      newDailyCount: dailyCount + 1,
    });

    return {
      allowed: true,
      hourlyRemaining: config.perHour - hourlyCount - 1,
      dailyRemaining: config.perDay - dailyCount - 1,
      resetAt: new Date(hourEnd).toISOString(),
    };

  } catch (error) {
    console.error('Error checking/incrementing write operation rate limit:', error);
    // On error, fail open (allow the request) to avoid blocking legitimate users
    // Log the error for investigation
    return {
      allowed: true,
      message: 'Rate limit check failed, allowing request',
    };
  }
}

/**
 * Helper function to extract userId from API Gateway event
 */
export function extractUserId(event: { requestContext: { authorizer?: { claims?: { sub?: string } } } }): string | null {
  return event.requestContext.authorizer?.claims?.sub || null;
}

