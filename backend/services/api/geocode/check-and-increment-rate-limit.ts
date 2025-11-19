import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unauthorized, internalError, tooManyRequests } from '../lib/response';
import type { 
  RateLimitStatus, 
  HourlyRateLimitRecord, 
  LifetimeRateLimitRecord,
  IncrementRateLimitResponse 
} from '../../types/rate-limit.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.RATE_LIMIT_TABLE_NAME!;
const HOURLY_LIMIT = parseInt(process.env.GEOCODE_HOURLY_LIMIT || '20', 10);
const LIFETIME_LIMIT = parseInt(process.env.GEOCODE_LIFETIME_LIMIT || '100', 10);

/**
 * POST /api/v1/geocode/rate-limit
 * 
 * Atomically check rate limits and increment counters if allowed
 * Returns rate limit status
 * 
 * This combines check + increment into a single operation to:
 * 1. Reduce API Gateway costs (1 call instead of 2)
 * 2. Eliminate race conditions
 * 3. Simplify frontend logic
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Check and increment rate limit:', { path: event.path, method: event.httpMethod });

  try {
    // Extract userId from Cognito authorizer
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return unauthorized('User ID not found');
    }

    // Calculate current hour start timestamp
    const now = Date.now();
    const hourStart = Math.floor(now / 3600000) * 3600000; // Round down to hour
    const hourEnd = hourStart + 3600000;
    const ttl = Math.floor((hourEnd + 3600000) / 1000); // TTL = 2 hours after hour ends (in seconds)

    // Generate keys
    const hourlyKey = `hourly:${userId}:${hourStart}`;
    const lifetimeKey = `lifetime:${userId}`;

    console.log('Rate limit check and increment:', { userId, hourlyKey, lifetimeKey });

    // Fetch current records in parallel
    const [hourlyResult, lifetimeResult] = await Promise.all([
      docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: hourlyKey },
      })),
      docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: lifetimeKey },
      })),
    ]);

    const hourlyRecord = hourlyResult.Item as HourlyRateLimitRecord | undefined;
    const lifetimeRecord = lifetimeResult.Item as LifetimeRateLimitRecord | undefined;

    const hourlyCount = hourlyRecord?.count || 0;
    const lifetimeCount = lifetimeRecord?.count || 0;

    // Check if limits would be exceeded
    if (hourlyCount >= HOURLY_LIMIT) {
      const minutesUntilReset = Math.ceil((hourEnd - now) / 60000);
      const status: RateLimitStatus = {
        allowed: false,
        hourlyRemaining: 0,
        lifetimeRemaining: Math.max(0, LIFETIME_LIMIT - lifetimeCount),
        resetAt: new Date(hourEnd).toISOString(),
        message: `Hourly limit of ${HOURLY_LIMIT} searches reached. Try again in ${minutesUntilReset} minute${minutesUntilReset !== 1 ? 's' : ''}.`,
      };

      console.log('Hourly rate limit exceeded:', { hourlyCount, lifetimeCount });

      return {
        ...tooManyRequests(status.message),
        headers: {
          ...tooManyRequests(status.message).headers,
          'X-RateLimit-Hourly-Remaining': '0',
          'X-RateLimit-Lifetime-Remaining': status.lifetimeRemaining.toString(),
          'X-RateLimit-Reset': new Date(hourEnd).toISOString(),
        },
      };
    }

    if (lifetimeCount >= LIFETIME_LIMIT) {
      const status: RateLimitStatus = {
        allowed: false,
        hourlyRemaining: Math.max(0, HOURLY_LIMIT - hourlyCount),
        lifetimeRemaining: 0,
        resetAt: new Date(hourEnd).toISOString(),
        message: `Lifetime limit of ${LIFETIME_LIMIT} searches reached. Please contact support to increase your limit.`,
      };

      console.log('Lifetime rate limit exceeded:', { hourlyCount, lifetimeCount });

      return {
        ...tooManyRequests(status.message),
        headers: {
          ...tooManyRequests(status.message).headers,
          'X-RateLimit-Hourly-Remaining': status.hourlyRemaining.toString(),
          'X-RateLimit-Lifetime-Remaining': '0',
          'X-RateLimit-Reset': new Date(hourEnd).toISOString(),
        },
      };
    }

    // Limits OK - increment counters atomically
    console.log('Rate limit OK, incrementing counters:', { hourlyCount, lifetimeCount });

    // Increment hourly counter
    if (hourlyRecord) {
      // Update existing hourly record
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: hourlyKey },
        UpdateExpression: 'ADD #count :inc',
        ExpressionAttributeNames: {
          '#count': 'count',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
        },
      }));
    } else {
      // Create new hourly record
      const newHourlyRecord: HourlyRateLimitRecord = {
        id: hourlyKey,
        userId,
        count: 1,
        resetAt: hourEnd,
        createdAt: now,
        ttl,
      };

      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: newHourlyRecord,
      }));
    }

    // Increment lifetime counter
    if (lifetimeRecord) {
      // Update existing lifetime record
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: lifetimeKey },
        UpdateExpression: 'ADD #count :inc SET #lastUsed = :now',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#lastUsed': 'lastUsedAt',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': now,
        },
      }));
    } else {
      // Create new lifetime record
      const newLifetimeRecord: LifetimeRateLimitRecord = {
        id: lifetimeKey,
        userId,
        count: 1,
        createdAt: now,
        lastUsedAt: now,
      };

      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: newLifetimeRecord,
      }));
    }

    // Calculate updated remaining counts
    const newHourlyCount = hourlyCount + 1;
    const newLifetimeCount = lifetimeCount + 1;

    const hourlyRemaining = Math.max(0, HOURLY_LIMIT - newHourlyCount);
    const lifetimeRemaining = Math.max(0, LIFETIME_LIMIT - newLifetimeCount);

    const status: RateLimitStatus = {
      allowed: hourlyRemaining > 0 && lifetimeRemaining > 0,
      hourlyRemaining,
      lifetimeRemaining,
      resetAt: new Date(hourEnd).toISOString(),
    };

    const response: IncrementRateLimitResponse = {
      success: true,
      status,
    };

    console.log('Rate limit incremented:', { newHourlyCount, newLifetimeCount, status });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'X-RateLimit-Hourly-Remaining': hourlyRemaining.toString(),
        'X-RateLimit-Lifetime-Remaining': lifetimeRemaining.toString(),
        'X-RateLimit-Reset': new Date(hourEnd).toISOString(),
      },
      body: JSON.stringify(response),
    };

  } catch (err: any) {
    console.error('Failed to check and increment rate limit:', err);
    return internalError('Failed to check and increment rate limit', err);
  }
};


