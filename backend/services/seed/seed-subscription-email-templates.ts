/**
 * Seed Script: Subscription Email Templates
 * 
 * Creates email templates for:
 * - SUBSCRIPTION_TRIAL_CONVERTED (Trial ended, subscription now active)
 * - SUBSCRIPTION_RENEWED (Subscription renewed successfully)
 * 
 * Run with:
 * AWS_REGION=eu-north-1 EMAIL_TEMPLATES_TABLE=localstays-staging-email-templates npx ts-node backend/services/seed/seed-subscription-email-templates.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.EMAIL_TEMPLATES_TABLE || 'localstays-staging-email-templates';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface EmailTemplate {
  templateId: string;
  language: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

const currentYear = new Date().getFullYear();

const templates: EmailTemplate[] = [
  // ============================================================================
  // SUBSCRIPTION_TRIAL_CONVERTED - English
  // ============================================================================
  {
    templateId: 'SUBSCRIPTION_TRIAL_CONVERTED',
    language: 'en',
    subject: 'Your LocalStays Trial Has Ended - Subscription Now Active',
    bodyText: `Hi {{name}},

Your free trial has ended and your LocalStays subscription is now active!

Subscription Details:
• Plan: {{planName}}
• Ad Slots: {{tokenCount}}
• Next Billing Date: {{nextBillingDate}}

Your listings will continue to be promoted without interruption. You can manage your subscription, view your ad slots, and track performance at any time.

Thank you for choosing LocalStays to promote your properties!

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
  <title>Trial Ended - Subscription Active</title>
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
              <!-- Success Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #ecfdf5; padding: 8px 16px; border-radius: 20px; border: 1px solid #a7f3d0;">
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Subscription Active</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your free trial has ended and your LocalStays subscription is now active!
              </p>
              <!-- Subscription Details Box -->
              <div style="background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151;">Subscription Details</p>
                <table cellpadding="0" cellspacing="0" style="width: 100%;">
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Plan:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{planName}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Ad Slots:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{tokenCount}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Next Billing:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{nextBillingDate}}</td>
                  </tr>
                </table>
              </div>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your listings will continue to be promoted without interruption.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      Go to Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Closing -->
              <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for choosing LocalStays to promote your properties!
              </p>
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
  },

  // ============================================================================
  // SUBSCRIPTION_TRIAL_CONVERTED - Serbian
  // ============================================================================
  {
    templateId: 'SUBSCRIPTION_TRIAL_CONVERTED',
    language: 'sr',
    subject: 'Vaš LocalStays probni period je završen - Pretplata je aktivna',
    bodyText: `Zdravo {{name}},

Vaš besplatni probni period je završen i vaša LocalStays pretplata je sada aktivna!

Detalji pretplate:
• Plan: {{planName}}
• Oglasnih mesta: {{tokenCount}}
• Sledeće naplaćivanje: {{nextBillingDate}}

Vaši oglasi će nastaviti da se promovišu bez prekida.

Hvala što ste izabrali LocalStays za promociju vaših nekretnina!

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
  <title>Probni period završen - Pretplata aktivna</title>
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
              <!-- Success Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #ecfdf5; padding: 8px 16px; border-radius: 20px; border: 1px solid #a7f3d0;">
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Pretplata aktivna</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Vaš besplatni probni period je završen i vaša LocalStays pretplata je sada aktivna!
              </p>
              <!-- Subscription Details Box -->
              <div style="background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151;">Detalji pretplate</p>
                <table cellpadding="0" cellspacing="0" style="width: 100%;">
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Plan:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{planName}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Oglasnih mesta:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{tokenCount}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Sledeće naplaćivanje:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{nextBillingDate}}</td>
                  </tr>
                </table>
              </div>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Vaši oglasi će nastaviti da se promovišu bez prekida.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      Idi na Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Closing -->
              <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala što ste izabrali LocalStays za promociju vaših nekretnina!
              </p>
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
  },

  // ============================================================================
  // SUBSCRIPTION_RENEWED - English
  // ============================================================================
  {
    templateId: 'SUBSCRIPTION_RENEWED',
    language: 'en',
    subject: 'Your LocalStays Subscription Has Been Renewed',
    bodyText: `Hi {{name}},

Great news! Your LocalStays subscription has been successfully renewed.

Subscription Details:
• Plan: {{planName}}
• Ad Slots: {{tokenCount}}
• Next Renewal: {{nextBillingDate}}

Your ad slots have been extended and your listings will continue to be promoted to travelers searching for accommodations in your area.

Thank you for your continued trust in LocalStays!

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
  <title>Subscription Renewed</title>
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
              <!-- Success Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #ecfdf5; padding: 8px 16px; border-radius: 20px; border: 1px solid #a7f3d0;">
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Subscription Renewed</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Great news! Your LocalStays subscription has been successfully renewed.
              </p>
              <!-- Subscription Details Box -->
              <div style="background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151;">Subscription Details</p>
                <table cellpadding="0" cellspacing="0" style="width: 100%;">
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Plan:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{planName}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Ad Slots:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{tokenCount}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Next Renewal:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{nextBillingDate}}</td>
                  </tr>
                </table>
              </div>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your ad slots have been extended and your listings will continue to be promoted to travelers searching for accommodations in your area.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      Go to Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Closing -->
              <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for your continued trust in LocalStays!
              </p>
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
  },

  // ============================================================================
  // SUBSCRIPTION_RENEWED - Serbian
  // ============================================================================
  {
    templateId: 'SUBSCRIPTION_RENEWED',
    language: 'sr',
    subject: 'Vaša LocalStays pretplata je obnovljena',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaša LocalStays pretplata je uspešno obnovljena.

Detalji pretplate:
• Plan: {{planName}}
• Oglasnih mesta: {{tokenCount}}
• Sledeće obnavljanje: {{nextBillingDate}}

Vaša oglasna mesta su produžena i vaši oglasi će nastaviti da se promovišu putnicima koji traže smeštaj u vašem području.

Hvala vam na poverenju u LocalStays!

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
  <title>Pretplata obnovljena</title>
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
              <!-- Success Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #ecfdf5; padding: 8px 16px; border-radius: 20px; border: 1px solid #a7f3d0;">
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Pretplata obnovljena</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Odlične vesti! Vaša LocalStays pretplata je uspešno obnovljena.
              </p>
              <!-- Subscription Details Box -->
              <div style="background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151;">Detalji pretplate</p>
                <table cellpadding="0" cellspacing="0" style="width: 100%;">
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Plan:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{planName}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Oglasnih mesta:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{tokenCount}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Sledeće obnavljanje:</td>
                    <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">{{nextBillingDate}}</td>
                  </tr>
                </table>
              </div>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Vaša oglasna mesta su produžena i vaši oglasi će nastaviti da se promovišu putnicima koji traže smeštaj u vašem području.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      Idi na Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Closing -->
              <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala vam na poverenju u LocalStays!
              </p>
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
  },
];

async function seedTemplates() {
  console.log('='.repeat(60));
  console.log('Seeding Subscription Email Templates');
  console.log(`Table: ${tableName}`);
  console.log(`Region: ${region}`);
  console.log('='.repeat(60));
  console.log('');

  for (const template of templates) {
    const pk = `EMAIL_TEMPLATE#${template.templateId}`;
    const sk = `LANG#${template.language}`;

    console.log(`📧 Seeding ${template.templateId} (${template.language})...`);

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk,
          sk,
          templateId: template.templateId,
          language: template.language,
          subject: template.subject,
          bodyText: template.bodyText,
          bodyHtml: template.bodyHtml,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    );

    console.log(`   ✅ Done: "${template.subject}"`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('✅ All templates seeded successfully!');
  console.log('='.repeat(60));
}

seedTemplates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  });


