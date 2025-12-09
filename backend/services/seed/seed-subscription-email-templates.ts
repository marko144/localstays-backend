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

Manage Subscription: {{subscriptionUrl}}

Thank you for choosing LocalStays to promote your properties!

Best regards,
The LocalStays Team`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Trial Ended - Subscription Active</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px;">Hi <strong>{{name}}</strong>,</p>
    
    <p>Your free trial has ended and your LocalStays subscription is now active!</p>
    
    <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #667eea;">Subscription Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Plan:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{planName}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Ad Slots:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{tokenCount}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Next Billing:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{nextBillingDate}}</td>
        </tr>
      </table>
    </div>
    
    <p>Your listings will continue to be promoted without interruption.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{subscriptionUrl}}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Manage Subscription</a>
    </div>
    
    <p>Thank you for choosing LocalStays to promote your properties!</p>
    
    <p style="color: #666; margin-top: 30px;">
      Best regards,<br>
      <strong>The LocalStays Team</strong>
    </p>
  </div>
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

Vaši oglasi će nastaviti da se promovišu bez prekida. Možete upravljati pretplatom, pregledati oglasna mesta i pratiti performanse u bilo kom trenutku.

Upravljanje pretplatom: {{subscriptionUrl}}

Hvala što ste izabrali LocalStays za promociju vaših nekretnina!

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Probni period završen - Pretplata aktivna</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px;">Zdravo <strong>{{name}}</strong>,</p>
    
    <p>Vaš besplatni probni period je završen i vaša LocalStays pretplata je sada aktivna!</p>
    
    <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #667eea;">Detalji pretplate</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Plan:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{planName}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Oglasnih mesta:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{tokenCount}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Sledeće naplaćivanje:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{nextBillingDate}}</td>
        </tr>
      </table>
    </div>
    
    <p>Vaši oglasi će nastaviti da se promovišu bez prekida.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{subscriptionUrl}}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Upravljanje pretplatom</a>
    </div>
    
    <p>Hvala što ste izabrali LocalStays za promociju vaših nekretnina!</p>
    
    <p style="color: #666; margin-top: 30px;">
      Srdačan pozdrav,<br>
      <strong>LocalStays Tim</strong>
    </p>
  </div>
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

Manage Subscription: {{subscriptionUrl}}

Thank you for your continued trust in LocalStays!

Best regards,
The LocalStays Team`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">✓ Subscription Renewed</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px;">Hi <strong>{{name}}</strong>,</p>
    
    <p>Great news! Your LocalStays subscription has been successfully renewed.</p>
    
    <div style="background: #f0fff4; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #38ef7d;">
      <h3 style="margin-top: 0; color: #11998e;">Subscription Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Plan:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{planName}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Ad Slots:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{tokenCount}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Next Renewal:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{nextBillingDate}}</td>
        </tr>
      </table>
    </div>
    
    <p>Your ad slots have been extended and your listings will continue to be promoted to travelers searching for accommodations in your area.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{subscriptionUrl}}" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Subscription</a>
    </div>
    
    <p>Thank you for your continued trust in LocalStays!</p>
    
    <p style="color: #666; margin-top: 30px;">
      Best regards,<br>
      <strong>The LocalStays Team</strong>
    </p>
  </div>
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

Upravljanje pretplatom: {{subscriptionUrl}}

Hvala vam na poverenju u LocalStays!

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">✓ Pretplata obnovljena</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px;">Zdravo <strong>{{name}}</strong>,</p>
    
    <p>Odlične vesti! Vaša LocalStays pretplata je uspešno obnovljena.</p>
    
    <div style="background: #f0fff4; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #38ef7d;">
      <h3 style="margin-top: 0; color: #11998e;">Detalji pretplate</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Plan:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{planName}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Oglasnih mesta:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{tokenCount}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Sledeće obnavljanje:</td>
          <td style="padding: 8px 0; font-weight: bold;">{{nextBillingDate}}</td>
        </tr>
      </table>
    </div>
    
    <p>Vaša oglasna mesta su produžena i vaši oglasi će nastaviti da se promovišu putnicima koji traže smeštaj u vašem području.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{subscriptionUrl}}" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Pogledaj pretplatu</a>
    </div>
    
    <p>Hvala vam na poverenju u LocalStays!</p>
    
    <p style="color: #666; margin-top: 30px;">
      Srdačan pozdrav,<br>
      <strong>LocalStays Tim</strong>
    </p>
  </div>
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


