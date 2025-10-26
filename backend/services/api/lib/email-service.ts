/**
 * Email Service Utility
 * Sends emails via SendGrid using templates from DynamoDB
 * Reuses SendGrid integration pattern from cognito-custom-email-sender
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import * as sgMail from '@sendgrid/mail';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({});

const EMAIL_TEMPLATES_TABLE = process.env.EMAIL_TEMPLATES_TABLE!;
const SENDGRID_PARAM = process.env.SENDGRID_PARAM!;
const FROM_EMAIL = process.env.FROM_EMAIL!;

// Module-scoped cache for SendGrid API key
let sendGridApiKey: string | null = null;

/**
 * Email template from DynamoDB
 */
interface EmailTemplate {
  pk: string;
  sk: string;
  templateName: string;
  language: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables: string[];
}

/**
 * Get SendGrid API key from SSM (with caching)
 */
async function getSendGridApiKey(): Promise<string> {
  if (sendGridApiKey) {
    return sendGridApiKey;
  }

  console.log('Fetching SendGrid API key from SSM...');
  
  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: SENDGRID_PARAM,
      WithDecryption: true,
    })
  );

  if (!response.Parameter?.Value) {
    throw new Error('SendGrid API key not found in SSM');
  }

  sendGridApiKey = response.Parameter.Value;
  console.log('SendGrid API key loaded successfully');
  
  return sendGridApiKey;
}

/**
 * Get email template from DynamoDB
 * Falls back to Serbian if requested language not found
 */
async function getEmailTemplate(
  templateName: string,
  language: string
): Promise<EmailTemplate | null> {
  console.log(`Fetching email template: ${templateName}, language: ${language}`);

  // Try requested language first
  let result = await docClient.send(
    new GetCommand({
      TableName: EMAIL_TEMPLATES_TABLE,
      Key: {
        pk: `EMAIL_TEMPLATE#${templateName}`,
        sk: `LANG#${language}`,
      },
    })
  );

  if (result.Item) {
    console.log(`Template found for language: ${language}`);
    return result.Item as EmailTemplate;
  }

  // Fallback to Serbian if requested language not found
  if (language !== 'sr') {
    console.log(`Template not found for ${language}, falling back to Serbian`);
    
    result = await docClient.send(
      new GetCommand({
        TableName: EMAIL_TEMPLATES_TABLE,
        Key: {
          pk: `EMAIL_TEMPLATE#${templateName}`,
          sk: 'LANG#sr',
        },
      })
    );

    if (result.Item) {
      console.log('Serbian template found');
      return result.Item as EmailTemplate;
    }
  }

  console.error(`Template not found: ${templateName} (tried ${language} and sr)`);
  return null;
}

/**
 * Replace template variables with actual values
 * Simple {{variable}} replacement
 */
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.split(placeholder).join(value);
  }
  
  return result;
}

/**
 * Normalize language code for template lookup
 * Converts BCP-47 codes (e.g., "sr-RS", "en-GB") to simple language codes ("sr", "en")
 */
function normalizeLanguageCode(languageCode: string): string {
  // Extract language part before hyphen (e.g., "sr-RS" -> "sr", "en-GB" -> "en")
  const language = languageCode.split('-')[0].toLowerCase();
  
  // Only support Serbian and English, default to Serbian
  if (language === 'en') {
    return 'en';
  }
  
  // Default to Serbian for any other language
  return 'sr';
}

/**
 * Send email using template
 */
export async function sendTemplatedEmail(
  templateName: string,
  recipientEmail: string,
  preferredLanguage: string,
  variables: Record<string, string>
): Promise<void> {
  try {
    console.log('Sending templated email:', {
      templateName,
      recipientEmail,
      preferredLanguage,
      variables,
    });

    // Normalize language code
    const language = normalizeLanguageCode(preferredLanguage);
    console.log(`Normalized language: ${preferredLanguage} -> ${language}`);

    // Get template
    const template = await getEmailTemplate(templateName, language);
    
    if (!template) {
      throw new Error(`Email template not found: ${templateName}`);
    }

    // Replace variables in subject and body
    const subject = replaceVariables(template.subject, variables);
    const bodyText = replaceVariables(template.bodyText, variables);
    const bodyHtml = replaceVariables(template.bodyHtml, variables);

    // Get SendGrid API key and send email
    const apiKey = await getSendGridApiKey();
    sgMail.setApiKey(apiKey);

    const msg = {
      to: recipientEmail,
      from: FROM_EMAIL,
      subject,
      text: bodyText,
      html: bodyHtml,
      // Disable click tracking
      trackingSettings: {
        clickTracking: {
          enable: false,
          enableText: false,
        },
      },
    };

    await sgMail.send(msg);
    
    console.log(`Email sent successfully to ${recipientEmail}`, {
      templateName,
      language,
      subject,
    });
  } catch (error: any) {
    console.error('Failed to send templated email:', {
      error: error.message,
      statusCode: error.code,
      templateName,
      recipientEmail,
      preferredLanguage,
    });
    
    // Re-throw to allow caller to handle
    throw error;
  }
}

/**
 * Send profile submission confirmation email
 */
export async function sendProfileSubmissionEmail(
  recipientEmail: string,
  preferredLanguage: string,
  name: string
): Promise<void> {
  await sendTemplatedEmail(
    'PROFILE_SUBMISSION_CONFIRMATION',
    recipientEmail,
    preferredLanguage,
    { name }
  );
}

/**
 * Send Live ID check request email
 */
export async function sendLiveIdCheckRequestEmail(
  recipientEmail: string,
  preferredLanguage: string,
  name: string
): Promise<void> {
  await sendTemplatedEmail(
    'LIVE_ID_CHECK_REQUEST',
    recipientEmail,
    preferredLanguage,
    { name }
  );
}



