/**
 * Subscription & Slot Email Templates Seed Data
 * 
 * Email templates for subscription lifecycle and advertising slot events:
 * - Ads expiring soon (7 days warning)
 * - Ads expired (slot deleted, listing unpublished)
 * - Payment failed (grace period started)
 * - Subscription cancelled
 * - Subscription welcome
 * - Subscription trial converted (trial ended, now paid)
 * - Subscription renewed
 * 
 * All templates in English (en) and Serbian (sr)
 */

import type { EmailTemplateSeed } from './admin-email-templates';

const now = new Date().toISOString();
const currentYear = new Date().getFullYear();

export const subscriptionEmailTemplates: EmailTemplateSeed[] = [
  // ========================================
  // ADS_EXPIRING_SOON - Warning 7 days before
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRING_SOON',
    sk: 'LANG#en',
    templateName: 'ADS_EXPIRING_SOON',
    language: 'en',
    subject: 'Your ads are expiring soon',
    bodyText: `Hi {{name}},

Your advertising slots are expiring soon. Here are the ads that will expire in 7 days:

{{listingsList}}

To keep your ads online, make sure your subscription is active. If your subscription is set to auto-renew, your ads will be automatically extended.

If you've cancelled your subscription, these ads will go offline when they expire.

Go to Dashboard: {{dashboardUrl}}

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
  <title>Your Ads Are Expiring Soon</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⏰ Expiring Soon</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Your advertising slots are expiring soon. Here are the ads that will expire in 7 days:</p>
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 20px;">{{listingsListHtml}}</div>
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">To keep your ads online, make sure your subscription is active. If your subscription is set to auto-renew, your ads will be automatically extended.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">If you've cancelled your subscription, these ads will go offline when they expire.</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Best regards,<br><span style="color: #374151; font-weight: 500;">The LocalStays Team</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. All rights reserved.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRING_SOON',
    sk: 'LANG#sr',
    templateName: 'ADS_EXPIRING_SOON',
    language: 'sr',
    subject: 'Vaši oglasi uskoro ističu',
    bodyText: `Zdravo {{name}},

Vaši oglasni slotovi uskoro ističu. Evo oglasa koji ističu za 7 dana:

{{listingsList}}

Da biste zadržali oglase online, proverite da li je vaša pretplata aktivna. Ako je vaša pretplata podešena na automatsko obnavljanje, oglasi će se automatski produžiti.

Ako ste otkazali pretplatu, ovi oglasi će biti isključeni kada isteknu.

Idite na kontrolnu tablu: {{dashboardUrl}}

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
  <title>Vaši oglasi uskoro ističu</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⏰ Uskoro ističe</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Vaši oglasni slotovi uskoro ističu. Evo oglasa koji ističu za 7 dana:</p>
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 20px;">{{listingsListHtml}}</div>
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">Da biste zadržali oglase online, proverite da li je vaša pretplata aktivna. Ako je vaša pretplata podešena na automatsko obnavljanje, oglasi će se automatski produžiti.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Ako ste otkazali pretplatu, ovi oglasi će biti isključeni kada isteknu.</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Idi na kontrolnu tablu</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Srdačan pozdrav,<br><span style="color: #374151; font-weight: 500;">LocalStays Tim</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. Sva prava zadržana.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // ADS_EXPIRED - Ads have been taken offline
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRED',
    sk: 'LANG#en',
    templateName: 'ADS_EXPIRED',
    language: 'en',
    subject: 'Your ads have expired',
    bodyText: `Hi {{name}},

The following ads have expired and are now offline:

{{listingsList}}

Your listings are still saved and can be published again once you have an active subscription with available tokens.

To get your ads back online:
1. Make sure you have an active subscription
2. Go to your listings and publish them again

Go to Dashboard: {{dashboardUrl}}

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
  <title>Your Ads Have Expired</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef2f2; padding: 8px 16px; border-radius: 20px; border: 1px solid #fecaca;">
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">📴 Ads Expired</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">The following ads have expired and are now offline:</p>
              <div style="background-color: #fef2f2; border-radius: 8px; padding: 16px; margin-bottom: 20px;">{{listingsListHtml}}</div>
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">Your listings are still saved and can be published again once you have an active subscription with available tokens.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;"><strong>To get your ads back online:</strong><br>1. Make sure you have an active subscription<br>2. Go to your listings and publish them again</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Best regards,<br><span style="color: #374151; font-weight: 500;">The LocalStays Team</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. All rights reserved.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRED',
    sk: 'LANG#sr',
    templateName: 'ADS_EXPIRED',
    language: 'sr',
    subject: 'Vaši oglasi su istekli',
    bodyText: `Zdravo {{name}},

Sledeći oglasi su istekli i sada su offline:

{{listingsList}}

Vaši oglasi su i dalje sačuvani i mogu se ponovo objaviti kada budete imali aktivnu pretplatu sa dostupnim tokenima.

Da vratite oglase online:
1. Proverite da imate aktivnu pretplatu
2. Idite na svoje oglase i ponovo ih objavite

Idite na kontrolnu tablu: {{dashboardUrl}}

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
  <title>Vaši oglasi su istekli</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef2f2; padding: 8px 16px; border-radius: 20px; border: 1px solid #fecaca;">
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">📴 Oglasi istekli</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Sledeći oglasi su istekli i sada su offline:</p>
              <div style="background-color: #fef2f2; border-radius: 8px; padding: 16px; margin-bottom: 20px;">{{listingsListHtml}}</div>
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">Vaši oglasi su i dalje sačuvani i mogu se ponovo objaviti kada budete imali aktivnu pretplatu sa dostupnim tokenima.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;"><strong>Da vratite oglase online:</strong><br>1. Proverite da imate aktivnu pretplatu<br>2. Idite na svoje oglase i ponovo ih objavite</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Idi na kontrolnu tablu</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Srdačan pozdrav,<br><span style="color: #374151; font-weight: 500;">LocalStays Tim</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. Sva prava zadržana.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // PAYMENT_FAILED - Grace period started
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#PAYMENT_FAILED',
    sk: 'LANG#en',
    templateName: 'PAYMENT_FAILED',
    language: 'en',
    subject: 'Payment failed - Action required',
    bodyText: `Hi {{name}},

We were unable to process your subscription payment.

Your ads will remain online during a short grace period, but you won't be able to publish new ads until the payment issue is resolved.

Please update your payment method to avoid any interruption to your service.

Go to Dashboard: {{dashboardUrl}}

If you have any questions, please contact our support team at hello@localstays.me.

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
  <title>Payment Failed - Action Required</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⚠ Payment Failed</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">We were unable to process your subscription payment.</p>
              <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #92400e;">Your ads will remain online during a short grace period, but you won't be able to publish new ads until the payment issue is resolved.</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Please update your payment method to avoid any interruption to your service.</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">If you have any questions, please contact us at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.</p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Best regards,<br><span style="color: #374151; font-weight: 500;">The LocalStays Team</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. All rights reserved.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#PAYMENT_FAILED',
    sk: 'LANG#sr',
    templateName: 'PAYMENT_FAILED',
    language: 'sr',
    subject: 'Plaćanje nije uspelo - Potrebna akcija',
    bodyText: `Zdravo {{name}},

Nismo uspeli da obradimo vašu uplatu za pretplatu.

Vaši oglasi će ostati online tokom kratkog perioda čekanja, ali nećete moći da objavljujete nove oglase dok se problem sa plaćanjem ne reši.

Molimo vas da ažurirate način plaćanja kako biste izbegli prekid usluge.

Idite na kontrolnu tablu: {{dashboardUrl}}

Ako imate pitanja, kontaktirajte nas na hello@localstays.me.

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
  <title>Plaćanje nije uspelo - Potrebna akcija</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⚠ Plaćanje neuspešno</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Nismo uspeli da obradimo vašu uplatu za pretplatu.</p>
              <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #92400e;">Vaši oglasi će ostati online tokom kratkog perioda čekanja, ali nećete moći da objavljujete nove oglase dok se problem sa plaćanjem ne reši.</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Molimo vas da ažurirate način plaćanja kako biste izbegli prekid usluge.</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Idi na kontrolnu tablu</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Ako imate pitanja, kontaktirajte nas na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.</p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Srdačan pozdrav,<br><span style="color: #374151; font-weight: 500;">LocalStays Tim</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. Sva prava zadržana.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // SUBSCRIPTION_CANCELLED - Confirmation
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_CANCELLED',
    sk: 'LANG#en',
    templateName: 'SUBSCRIPTION_CANCELLED',
    language: 'en',
    subject: 'Your LocalStays subscription has been cancelled',
    bodyText: `Hi {{name}},

Your LocalStays subscription has been cancelled as requested.

Your current ads will remain online until {{periodEndDate}}, after which they will be taken offline.

If you change your mind, you can resubscribe at any time from your dashboard.

We hope to see you again soon!

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
  <title>Subscription Cancelled</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f3f4f6; padding: 8px 16px; border-radius: 20px; border: 1px solid #d1d5db;">
                    <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Subscription Cancelled</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Your LocalStays subscription has been cancelled as requested.</p>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #374151;">Your current ads will remain online until <strong style="color: #111827;">{{periodEndDate}}</strong>, after which they will be taken offline.</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">If you change your mind, you can resubscribe at any time from your dashboard.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">We hope to see you again soon!</p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Best regards,<br><span style="color: #374151; font-weight: 500;">The LocalStays Team</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. All rights reserved.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'periodEndDate'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_CANCELLED',
    sk: 'LANG#sr',
    templateName: 'SUBSCRIPTION_CANCELLED',
    language: 'sr',
    subject: 'Vaša LocalStays pretplata je otkazana',
    bodyText: `Zdravo {{name}},

Vaša LocalStays pretplata je otkazana po vašem zahtevu.

Vaši trenutni oglasi će ostati online do {{periodEndDate}}, nakon čega će biti isključeni.

Ako se predomislite, možete se ponovo pretplatiti u bilo kom trenutku sa vašeg dashboard-a.

Nadamo se da ćemo vas ponovo videti uskoro!

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
  <title>Pretplata otkazana</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f3f4f6; padding: 8px 16px; border-radius: 20px; border: 1px solid #d1d5db;">
                    <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Pretplata otkazana</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Vaša LocalStays pretplata je otkazana po vašem zahtevu.</p>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #374151;">Vaši trenutni oglasi će ostati online do <strong style="color: #111827;">{{periodEndDate}}</strong>, nakon čega će biti isključeni.</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Ako se predomislite, možete se ponovo pretplatiti u bilo kom trenutku sa vašeg dashboard-a.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Nadamo se da ćemo vas ponovo videti uskoro!</p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Srdačan pozdrav,<br><span style="color: #374151; font-weight: 500;">LocalStays Tim</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. Sva prava zadržana.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'periodEndDate'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // SUBSCRIPTION_WELCOME - New subscription
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_WELCOME',
    sk: 'LANG#en',
    templateName: 'SUBSCRIPTION_WELCOME',
    language: 'en',
    subject: 'Welcome to LocalStays {{planName}}!',
    bodyText: `Hi {{name}},

Thank you for subscribing to LocalStays {{planName}}!

Your subscription details:
- Plan: {{planName}}
- Tokens: {{tokenCount}} ads
- Billing period: {{billingPeriod}}
- Next billing date: {{nextBillingDate}}

You can now publish up to {{tokenCount}} ads at the same time. Go to your listings to get started!

Go to Dashboard: {{dashboardUrl}}

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
  <title>Welcome to LocalStays</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #ecfdf5; padding: 8px 16px; border-radius: 20px; border: 1px solid #a7f3d0;">
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">🎉 Welcome!</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Thank you for subscribing to LocalStays <strong style="color: #111827;">{{planName}}</strong>!</p>
              <div style="background-color: #ecfdf5; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #065f46;">Your subscription details:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.8; color: #047857;">• Plan: {{planName}}<br>• Tokens: {{tokenCount}} ads<br>• Billing period: {{billingPeriod}}<br>• Next billing date: {{nextBillingDate}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">You can now publish up to <strong style="color: #111827;">{{tokenCount}}</strong> ads at the same time. Go to your listings to get started!</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Best regards,<br><span style="color: #374151; font-weight: 500;">The LocalStays Team</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. All rights reserved.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'planName', 'tokenCount', 'billingPeriod', 'nextBillingDate', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_WELCOME',
    sk: 'LANG#sr',
    templateName: 'SUBSCRIPTION_WELCOME',
    language: 'sr',
    subject: 'Dobrodošli u LocalStays {{planName}}!',
    bodyText: `Zdravo {{name}},

Hvala vam što ste se pretplatili na LocalStays {{planName}}!

Detalji vaše pretplate:
- Plan: {{planName}}
- Tokeni: {{tokenCount}} oglasa
- Period naplate: {{billingPeriod}}
- Sledeći datum naplate: {{nextBillingDate}}

Sada možete objaviti do {{tokenCount}} oglasa istovremeno. Idite na svoje oglase da započnete!

Idite na kontrolnu tablu: {{dashboardUrl}}

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
  <title>Dobrodošli u LocalStays</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
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
          <tr>
            <td style="background-color: #ffffff; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #ecfdf5; padding: 8px 16px; border-radius: 20px; border: 1px solid #a7f3d0;">
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">🎉 Dobrodošli!</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hvala vam što ste se pretplatili na LocalStays <strong style="color: #111827;">{{planName}}</strong>!</p>
              <div style="background-color: #ecfdf5; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #065f46;">Detalji vaše pretplate:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.8; color: #047857;">• Plan: {{planName}}<br>• Tokeni: {{tokenCount}} oglasa<br>• Period naplate: {{billingPeriod}}<br>• Sledeći datum naplate: {{nextBillingDate}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Sada možete objaviti do <strong style="color: #111827;">{{tokenCount}}</strong> oglasa istovremeno. Idite na svoje oglase da započnete!</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Idi na kontrolnu tablu</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Srdačan pozdrav,<br><span style="color: #374151; font-weight: 500;">LocalStays Tim</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">© ${currentYear} LocalStays. Sva prava zadržana.<br><a href="mailto:hello@localstays.me" style="color: #6b7280; text-decoration: none;">hello@localstays.me</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    variables: ['name', 'planName', 'tokenCount', 'billingPeriod', 'nextBillingDate', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // SUBSCRIPTION_TRIAL_CONVERTED - Trial ended, now paid
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_TRIAL_CONVERTED',
    sk: 'LANG#en',
    templateName: 'SUBSCRIPTION_TRIAL_CONVERTED',
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
    variables: ['name', 'planName', 'tokenCount', 'nextBillingDate', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_TRIAL_CONVERTED',
    sk: 'LANG#sr',
    templateName: 'SUBSCRIPTION_TRIAL_CONVERTED',
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
    variables: ['name', 'planName', 'tokenCount', 'nextBillingDate', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // SUBSCRIPTION_RENEWED - Subscription renewed successfully
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_RENEWED',
    sk: 'LANG#en',
    templateName: 'SUBSCRIPTION_RENEWED',
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
    variables: ['name', 'planName', 'tokenCount', 'nextBillingDate', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_RENEWED',
    sk: 'LANG#sr',
    templateName: 'SUBSCRIPTION_RENEWED',
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
    variables: ['name', 'planName', 'tokenCount', 'nextBillingDate', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
];

