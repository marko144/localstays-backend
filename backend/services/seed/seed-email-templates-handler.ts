/**
 * Email Templates Seeding Lambda Handler
 * Seeds initial email templates into DynamoDB
 * Triggered by CustomResource during stack deployment
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface EmailTemplate {
  pk: string;
  sk: string;
  templateName: string;
  language: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables: string[];
  version: string;
  createdAt: string;
  updatedAt: string;
}

const now = new Date().toISOString();
const currentYear = new Date().getFullYear();

/**
 * Email templates to seed
 */
const EMAIL_TEMPLATES: EmailTemplate[] = [
  // ========================================
  // PROFILE_SUBMISSION_CONFIRMATION - English
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#PROFILE_SUBMISSION_CONFIRMATION',
    sk: 'LANG#en',
    templateName: 'PROFILE_SUBMISSION_CONFIRMATION',
    language: 'en',
    subject: 'Profile Successfully Submitted',
    bodyText: `Hi {{name}},

Thank you for submitting your profile information.

We will verify your details and get in touch if we need more information.

Best regards,
The LocalStays Team

---
© ${currentYear} LocalStays
hello@localstays.me`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Profile Successfully Submitted</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- HEADER -->
          <tr>
            <td style="background-color: #243447; padding: 24px 40px; border-radius: 12px 12px 0 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 12px; vertical-align: middle;">
                    <div style="width: 36px; height: 36px; background-color: #ffffff; border-radius: 8px; text-align: center; line-height: 36px;">
                      <span style="color: #243447; font-size: 20px; font-weight: 700;">L</span>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 700;">Local</span><span style="color: #FF6B6B; font-size: 24px; font-weight: 700;">Stays</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CONTENT -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <!-- Info Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #eff6ff; padding: 8px 16px; border-radius: 20px; border: 1px solid #bfdbfe;">
                    <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">📋 Submission Received</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for submitting your profile information.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                We will verify your details and get in touch if we need more information.
              </p>
              <!-- Closing -->
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">
                Best regards,<br>
                <span style="color: #374151; font-weight: 500;">The LocalStays Team</span>
              </p>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
                © ${currentYear} LocalStays. All rights reserved.<br>
                <a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name'],
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#PROFILE_SUBMISSION_CONFIRMATION',
    sk: 'LANG#sr',
    templateName: 'PROFILE_SUBMISSION_CONFIRMATION',
    language: 'sr',
    subject: 'Profil uspešno poslat',
    bodyText: `Zdravo {{name}},

Hvala što ste poslali informacije o svom profilu.

Verifikovaćemo vaše podatke i kontaktiraćemo vas ako nam bude potrebno više informacija.

Srdačan pozdrav,
LocalStays Tim

---
© ${currentYear} LocalStays
hello@localstays.me`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Profil uspešno poslat</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- HEADER -->
          <tr>
            <td style="background-color: #243447; padding: 24px 40px; border-radius: 12px 12px 0 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 12px; vertical-align: middle;">
                    <div style="width: 36px; height: 36px; background-color: #ffffff; border-radius: 8px; text-align: center; line-height: 36px;">
                      <span style="color: #243447; font-size: 20px; font-weight: 700;">L</span>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 700;">Local</span><span style="color: #FF6B6B; font-size: 24px; font-weight: 700;">Stays</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CONTENT -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <!-- Info Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #eff6ff; padding: 8px 16px; border-radius: 20px; border: 1px solid #bfdbfe;">
                    <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">📋 Prijava primljena</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala što ste poslali informacije o svom profilu.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Verifikovaćemo vaše podatke i kontaktiraćemo vas ako nam bude potrebno više informacija.
              </p>
              <!-- Closing -->
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">
                Srdačan pozdrav,<br>
                <span style="color: #374151; font-weight: 500;">LocalStays Tim</span>
              </p>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
                © ${currentYear} LocalStays. Sva prava zadržana.<br>
                <a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name'],
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // LIVE_ID_CHECK_REQUEST - English
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LIVE_ID_CHECK_REQUEST',
    sk: 'LANG#en',
    templateName: 'LIVE_ID_CHECK_REQUEST',
    language: 'en',
    subject: 'Action Required: Complete Your Live ID Check',
    bodyText: `Hi {{name}},

Thank you for submitting your profile information.

To complete your verification, please log in to your host portal and complete the Live ID check. This helps us verify your identity and keep our community safe.

Go to Dashboard: {{dashboardUrl}}

If you have any questions, please don't hesitate to contact us at hello@localstays.me.

Best regards,
The LocalStays Team

---
© ${currentYear} LocalStays
hello@localstays.me`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Required: Complete Your Live ID Check</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- HEADER -->
          <tr>
            <td style="background-color: #243447; padding: 24px 40px; border-radius: 12px 12px 0 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 12px; vertical-align: middle;">
                    <div style="width: 36px; height: 36px; background-color: #ffffff; border-radius: 8px; text-align: center; line-height: 36px;">
                      <span style="color: #243447; font-size: 20px; font-weight: 700;">L</span>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 700;">Local</span><span style="color: #FF6B6B; font-size: 24px; font-weight: 700;">Stays</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CONTENT -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <!-- Action Required Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⚠ Action Required</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for submitting your profile information.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                To complete your verification, please log in to your host portal and complete the Live ID check. This helps us verify your identity and keep our community safe.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                If you have any questions, please don't hesitate to contact us at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
              </p>
              <!-- Closing -->
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">
                Best regards,<br>
                <span style="color: #374151; font-weight: 500;">The LocalStays Team</span>
              </p>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
                © ${currentYear} LocalStays. All rights reserved.<br>
                <a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'dashboardUrl'],
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LIVE_ID_CHECK_REQUEST',
    sk: 'LANG#sr',
    templateName: 'LIVE_ID_CHECK_REQUEST',
    language: 'sr',
    subject: 'Potrebna akcija: Završite proveru identiteta uživo',
    bodyText: `Zdravo {{name}},

Hvala vam što ste poslali informacije o svom profilu.

Da biste završili verifikaciju, molimo vas da se prijavite na svoj portal i završite proveru identiteta uživo. Ovo nam pomaže da potvrdimo vaš identitet i održimo našu zajednicu bezbednom.

Idite na kontrolnu tablu: {{dashboardUrl}}

Ako imate bilo kakvih pitanja, slobodno nas kontaktirajte na hello@localstays.me.

Srdačan pozdrav,
LocalStays Tim

---
© ${currentYear} LocalStays
hello@localstays.me`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potrebna akcija: Završite proveru identiteta uživo</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- HEADER -->
          <tr>
            <td style="background-color: #243447; padding: 24px 40px; border-radius: 12px 12px 0 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 12px; vertical-align: middle;">
                    <div style="width: 36px; height: 36px; background-color: #ffffff; border-radius: 8px; text-align: center; line-height: 36px;">
                      <span style="color: #243447; font-size: 20px; font-weight: 700;">L</span>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 700;">Local</span><span style="color: #FF6B6B; font-size: 24px; font-weight: 700;">Stays</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CONTENT -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <!-- Action Required Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⚠ Potrebna akcija</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala vam što ste poslali informacije o svom profilu.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Da biste završili verifikaciju, molimo vas da se prijavite na svoj portal i završite proveru identiteta uživo. Ovo nam pomaže da potvrdimo vaš identitet i održimo našu zajednicu bezbednom.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Idi na kontrolnu tablu</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Ako imate bilo kakvih pitanja, slobodno nas kontaktirajte na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
              </p>
              <!-- Closing -->
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">
                Srdačan pozdrav,<br>
                <span style="color: #374151; font-weight: 500;">LocalStays Tim</span>
              </p>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
                © ${currentYear} LocalStays. Sva prava zadržana.<br>
                <a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'dashboardUrl'],
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
  },
];

// Import admin email templates
import { adminEmailTemplates } from './admin-email-templates';

// Import subscription email templates
import { subscriptionEmailTemplates } from './subscription-email-templates';

// Import verification email templates
import { verificationEmailTemplates } from './verification-email-templates';

// Combine all templates
const ALL_EMAIL_TEMPLATES = [...EMAIL_TEMPLATES, ...adminEmailTemplates, ...subscriptionEmailTemplates, ...verificationEmailTemplates];

/**
 * Seed email templates into DynamoDB
 */
async function seedEmailTemplates(): Promise<void> {
  console.log(`Seeding ${ALL_EMAIL_TEMPLATES.length} email templates...`);

  // Batch write templates (max 25 items per batch)
  const batchSize = 25;
  for (let i = 0; i < ALL_EMAIL_TEMPLATES.length; i += batchSize) {
    const batch = ALL_EMAIL_TEMPLATES.slice(i, i + batchSize);
    
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((template) => ({
            PutRequest: {
              Item: template,
            },
          })),
        },
      })
    );

    console.log(`Seeded batch ${Math.floor(i / batchSize) + 1} (${batch.length} templates)`);
  }

  console.log(`Email templates seeding completed successfully (${ALL_EMAIL_TEMPLATES.length} total)`);
}

/**
 * CustomResource handler
 * Runs on Create and Update events
 */
export async function handler(event: any): Promise<any> {
  console.log('Email templates seed handler invoked', {
    RequestType: event.RequestType,
    ResourceProperties: event.ResourceProperties,
  });

  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      await seedEmailTemplates();
    }

    // Return success response for CustomResource
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: event.PhysicalResourceId || 'EmailTemplatesSeed',
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {
        Message: 'Email templates seeded successfully',
        TemplateCount: ALL_EMAIL_TEMPLATES.length,
      },
    };
  } catch (error: any) {
    console.error('Failed to seed email templates:', error);
    
    // Return failure response for CustomResource
    return {
      Status: 'FAILED',
      Reason: error.message,
      PhysicalResourceId: event.PhysicalResourceId || 'EmailTemplatesSeed',
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  }
}



