/**
 * DynamoDB Transaction Utilities
 * Helper functions for atomic operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Execute a transactional write with retry logic
 * Handles TransactionCanceledException with exponential backoff
 * 
 * @param input - TransactWrite command input
 * @param maxRetries - Maximum number of retries (default: 3)
 */
export async function executeTransaction(
  input: TransactWriteCommandInput,
  maxRetries: number = 3
): Promise<void> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      await docClient.send(new TransactWriteCommand(input));
      return; // Success
    } catch (error: any) {
      attempt++;
      
      // Retry on transaction conflicts or throttling
      if (
        (error.name === 'TransactionCanceledException' ||
         error.name === 'ProvisionedThroughputExceededException') &&
        attempt < maxRetries
      ) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
        console.log(`Transaction failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Re-throw if not retryable or max retries exceeded
      console.error('Transaction failed:', {
        error: error.message,
        attempt,
        maxRetries,
      });
      throw error;
    }
  }
}

/**
 * Get table name (useful for building transaction items)
 */
export function getTableName(): string {
  return TABLE_NAME;
}

