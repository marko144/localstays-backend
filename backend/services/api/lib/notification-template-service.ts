/**
 * Notification Template Service
 * 
 * Fetches and renders notification templates from DynamoDB
 * Similar to email-service.ts but for push notifications
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { 
  NotificationTemplate, 
  NotificationTemplateName,
  NotificationTemplateVariables,
  NotificationPayload
} from '../../types/notification.types';
import { sendNotificationToUser } from './notification-utils';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

/**
 * Fetch notification template from DynamoDB
 * Falls back to English if requested language not found
 * Falls back to Serbian if English not found
 */
export async function getNotificationTemplate(
  templateName: NotificationTemplateName,
  language: string
): Promise<NotificationTemplate | null> {
  // Normalize language code (sr-RS -> sr, en-US -> en)
  const normalizedLang = language.split('-')[0].toLowerCase();

  // Try requested language
  let template = await fetchTemplate(templateName, normalizedLang);
  if (template) {
    console.log(`Notification template found: ${templateName}, language: ${normalizedLang}`);
    return template;
  }

  // Fallback to English
  if (normalizedLang !== 'en') {
    console.log(`Notification template not found for ${normalizedLang}, trying English`);
    template = await fetchTemplate(templateName, 'en');
    if (template) {
      console.log(`Using English fallback for notification template: ${templateName}`);
      return template;
    }
  }

  // Fallback to Serbian
  if (normalizedLang !== 'sr') {
    console.log(`Notification template not found in English, trying Serbian`);
    template = await fetchTemplate(templateName, 'sr');
    if (template) {
      console.log(`Using Serbian fallback for notification template: ${templateName}`);
      return template;
    }
  }

  console.error(`Notification template not found: ${templateName} (tried: ${normalizedLang}, en, sr)`);
  return null;
}

/**
 * Fetch template from DynamoDB
 */
async function fetchTemplate(
  templateName: NotificationTemplateName,
  language: string
): Promise<NotificationTemplate | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `NOTIFICATION_TEMPLATE#${templateName}`,
          sk: `LANG#${language}`,
        },
      })
    );

    return result.Item as NotificationTemplate | null;
  } catch (error) {
    console.error(`Error fetching notification template ${templateName} (${language}):`, error);
    return null;
  }
}

/**
 * Render template with variables (simple {{variable}} replacement)
 */
export function renderNotificationTemplate(
  template: NotificationTemplate,
  variables: NotificationTemplateVariables
): { title: string; body: string; actionUrlPath?: string } {
  let title = template.title;
  let body = template.body;
  let actionUrlPath = template.actionUrlPath;

  // Replace all {{variable}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    title = title.replace(new RegExp(placeholder, 'g'), value);
    body = body.replace(new RegExp(placeholder, 'g'), value);
    if (actionUrlPath) {
      actionUrlPath = actionUrlPath.replace(new RegExp(placeholder, 'g'), value);
    }
  }

  return { title, body, actionUrlPath };
}

/**
 * Build full notification URL from template path and language
 * Constructs: {FRONTEND_URL}/{language}{actionUrlPath}
 * Example: https://staging.portal.localstays.me/sr/listings/listing_123
 */
export function buildNotificationUrl(
  actionUrlPath: string | undefined,
  language: string
): string | undefined {
  if (!actionUrlPath) {
    return undefined;
  }

  // Normalize language code (sr-RS -> sr)
  const normalizedLang = language.split('-')[0].toLowerCase();

  // Construct full URL
  return `${FRONTEND_URL}/${normalizedLang}${actionUrlPath}`;
}

/**
 * Send templated notification to a user
 * Main function to use from other services
 */
export async function sendTemplatedNotification(
  userId: string,
  templateName: NotificationTemplateName,
  language: string,
  variables: NotificationTemplateVariables
): Promise<{ sent: number; failed: number; deactivated: number }> {
  // Fetch template
  const template = await getNotificationTemplate(templateName, language);
  
  if (!template) {
    console.error(`Cannot send notification: template ${templateName} not found`);
    return { sent: 0, failed: 0, deactivated: 0 };
  }

  // Render template with variables
  const rendered = renderNotificationTemplate(template, variables);

  // Build full URL
  const fullUrl = buildNotificationUrl(rendered.actionUrlPath, language);

  // Construct notification payload
  const payload: NotificationPayload = {
    title: rendered.title,
    body: rendered.body,
    icon: template.icon,
    badge: template.badge,
    image: template.image,
    data: {
      url: fullUrl,
      ...variables, // Include all variables in data for frontend use
      type: templateName.toLowerCase(),
    },
    tag: template.tag || `${templateName.toLowerCase()}-${variables.listingId || variables.hostId || Date.now()}`,
    requireInteraction: template.requireInteraction ?? true,
    silent: template.silent ?? false,
  };

  console.log(`Sending templated notification to user ${userId}:`, {
    templateName,
    language,
    title: rendered.title,
    url: fullUrl,
  });

  // Send notification using notification-utils
  return await sendNotificationToUser(userId, payload);
}

