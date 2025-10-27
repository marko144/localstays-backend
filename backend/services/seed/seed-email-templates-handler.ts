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

/**
 * Email templates to seed
 */
const EMAIL_TEMPLATES: EmailTemplate[] = [
  // ========================================
  // PROFILE_SUBMISSION_CONFIRMATION - Serbian
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#PROFILE_SUBMISSION_CONFIRMATION',
    sk: 'LANG#sr',
    templateName: 'PROFILE_SUBMISSION_CONFIRMATION',
    language: 'sr',
    subject: 'Profil uspešno poslat',
    bodyText: `Poštovani/a {{name}},

Hvala što ste poslali informacije o svom profilu.

Verifikovaćemo vaše podatke i kontaktiraćemo vas ako nam bude potrebno više informacija.

Srdačan pozdrav,
Localstays tim`,
    bodyHtml: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Profil uspešno poslat</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <tr>
              <td style="padding: 40px 40px 20px 40px;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #333333;">Profil uspešno poslat</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 40px 20px 40px;">
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Poštovani/a {{name}},
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Hvala što ste poslali informacije o svom profilu.
                </p>
                <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Verifikovaćemo vaše podatke i kontaktiraćemo vas ako nam bude potrebno više informacija.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 40px 40px 40px; border-top: 1px solid #eeeeee;">
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #999999;">
                  Srdačan pozdrav,<br>
                  Localstays tim
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ========================================
  // PROFILE_SUBMISSION_CONFIRMATION - English
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#PROFILE_SUBMISSION_CONFIRMATION',
    sk: 'LANG#en',
    templateName: 'PROFILE_SUBMISSION_CONFIRMATION',
    language: 'en',
    subject: 'Profile Successfully Submitted',
    bodyText: `Dear {{name}},

Thank you for submitting your profile information.

We will verify your details and get in touch if we need more information.

Best regards,
Localstays Team`,
    bodyHtml: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Profile Successfully Submitted</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <tr>
              <td style="padding: 40px 40px 20px 40px;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #333333;">Profile Successfully Submitted</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 40px 20px 40px;">
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Dear {{name}},
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Thank you for submitting your profile information.
                </p>
                <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  We will verify your details and get in touch if we need more information.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 40px 40px 40px; border-top: 1px solid #eeeeee;">
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #999999;">
                  Best regards,<br>
                  Localstays Team
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ========================================
  // LIVE_ID_CHECK_REQUEST - Serbian
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LIVE_ID_CHECK_REQUEST',
    sk: 'LANG#sr',
    templateName: 'LIVE_ID_CHECK_REQUEST',
    language: 'sr',
    subject: 'Potrebna akcija: Završite proveru identiteta uživo',
    bodyText: `Poštovani/a {{name}},

Hvala vam što ste poslali informacije o svom profilu.

Da biste završili verifikaciju, molimo vas da se prijavite na svoj portal i završite proveru identiteta uživo. Ovo nam pomaže da potvrdimo vaš identitet i održimo našu zajednicu bezbednom.

Molimo vas prijavite se da završite ovaj korak.

Ako imate bilo kakvih pitanja, slobodno nas kontaktirajte.

Srdačan pozdrav,
Localstays tim`,
    bodyHtml: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Potrebna akcija: Završite proveru identiteta uživo</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <tr>
              <td style="padding: 40px 40px 20px 40px;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #333333;">Potrebna akcija: Završite proveru identiteta uživo</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 40px 20px 40px;">
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Poštovani/a {{name}},
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Hvala vam što ste poslali informacije o svom profilu.
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Da biste završili verifikaciju, molimo vas da se prijavite na svoj portal i završite proveru identiteta uživo. Ovo nam pomaže da potvrdimo vaš identitet i održimo našu zajednicu bezbednom.
                </p>
                <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Molimo vas prijavite se da završite ovaj korak.
                </p>
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #999999;">
                  Ako imate bilo kakvih pitanja, slobodno nas kontaktirajte.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 40px 40px 40px; border-top: 1px solid #eeeeee;">
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #999999;">
                  Srdačan pozdrav,<br>
                  Localstays tim
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    bodyText: `Dear {{name}},

Thank you for submitting your profile information.

To complete your verification, please log in to your host portal and complete the Live ID check. This helps us verify your identity and keep our community safe.

Please log in to complete this step.

If you have any questions, please don't hesitate to contact us.

Best regards,
The Localstays Team`,
    bodyHtml: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Action Required: Complete Your Live ID Check</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <tr>
              <td style="padding: 40px 40px 20px 40px;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #333333;">Action Required: Complete Your Live ID Check</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 40px 20px 40px;">
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Dear {{name}},
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Thank you for submitting your profile information.
                </p>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  To complete your verification, please log in to your host portal and complete the Live ID check. This helps us verify your identity and keep our community safe.
                </p>
                <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.5; color: #666666;">
                  Please log in to complete this step.
                </p>
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #999999;">
                  If you have any questions, please don't hesitate to contact us.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 40px 40px 40px; border-top: 1px solid #eeeeee;">
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #999999;">
                  Best regards,<br>
                  The Localstays Team
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Import admin email templates
import { adminEmailTemplates } from './admin-email-templates';

// Combine all templates
const ALL_EMAIL_TEMPLATES = [...EMAIL_TEMPLATES, ...adminEmailTemplates];

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



