/**
 * Property Verification Email Templates Seed Data
 * Contains all 12 verification email templates in English and Serbian
 * (Video Verification + Address Verification)
 * To be inserted into the EmailTemplates DynamoDB table
 */

export interface EmailTemplateSeed {
  pk: string;
  sk: string;
  templateName: string;
  language: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

const now = new Date().toISOString();
const currentYear = new Date().getFullYear();

export const verificationEmailTemplates: EmailTemplateSeed[] = [
  // ========================================
  // 1. VIDEO_VERIFICATION_REQUEST
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REQUEST',
    sk: 'LANG#en',
    templateName: 'VIDEO_VERIFICATION_REQUEST',
    language: 'en',
    subject: 'Property Video Verification Required',
    bodyText: `Hi {{name}},

We need you to upload a video tour of your property at {{listingAddress}}.

This video verification helps us ensure the quality and accuracy of listings on LocalStays.

What to include in your video:
- All rooms and living spaces
- Bathroom(s) and kitchen
- Outdoor areas (if applicable)
- Any amenities mentioned in your listing

Requirements:
- Maximum file size: 200MB
- Supported formats: MP4, MOV, WebM
- Duration: 2-5 minutes recommended

Go to Dashboard: {{dashboardUrl}}

If you have any questions, contact our support team at hello@localstays.me.

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
  <title>Property Video Verification Required</title>
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
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">🎥 Video Required</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">We need you to upload a video tour of your property at <strong style="color: #111827;">{{listingAddress}}</strong>.</p>
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">This video verification helps us ensure the quality and accuracy of listings on LocalStays.</p>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #374151;">What to include:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">• All rooms and living spaces<br>• Bathroom(s) and kitchen<br>• Outdoor areas (if applicable)<br>• Any amenities mentioned in your listing</p>
              </div>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #374151;">Requirements:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">• Max file size: 200MB<br>• Formats: MP4, MOV, WebM<br>• Duration: 2-5 minutes recommended</p>
              </div>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">If you have any questions, contact us at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.</p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #6b7280;">Best regards,<br><span style="color: #374151; font-weight: 500;">The LocalStays Team</span></p>
            </td>
          </tr>
          <!-- FOOTER -->
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
    variables: ['name', 'listingAddress', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REQUEST',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_REQUEST',
    language: 'sr',
    subject: 'Potrebna verifikacija video snimka nekretnine',
    bodyText: `Zdravo {{name}},

Potrebno je da otpremite video snimak vaše nekretnine na adresi {{listingAddress}}.

Ova video verifikacija nam pomaže da osiguramo kvalitet i tačnost oglasa na LocalStays platformi.

Šta treba da uključite u video snimak:
- Sve sobe i dnevne prostore
- Kupatilo(a) i kuhinju
- Spoljne prostore (ako postoje)
- Sve sadržaje navedene u vašem oglasu

Zahtevi:
- Maksimalna veličina fajla: 200MB
- Podržani formati: MP4, MOV, WebM
- Trajanje: preporučuje se 2-5 minuta

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
  <title>Potrebna verifikacija video snimka nekretnine</title>
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
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; padding: 8px 16px; border-radius: 20px; border: 1px solid #fcd34d;">
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">🎥 Potreban video</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Potrebno je da otpremite video snimak vaše nekretnine na adresi <strong style="color: #111827;">{{listingAddress}}</strong>.</p>
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">Ova video verifikacija nam pomaže da osiguramo kvalitet i tačnost oglasa na LocalStays platformi.</p>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #374151;">Šta uključiti:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">• Sve sobe i dnevne prostore<br>• Kupatilo(a) i kuhinju<br>• Spoljne prostore (ako postoje)<br>• Sve sadržaje navedene u oglasu</p>
              </div>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #374151;">Zahtevi:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">• Maks. veličina: 200MB<br>• Formati: MP4, MOV, WebM<br>• Trajanje: 2-5 minuta</p>
              </div>
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
          <!-- FOOTER -->
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
    variables: ['name', 'listingAddress', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 2. VIDEO_VERIFICATION_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_APPROVED',
    sk: 'LANG#en',
    templateName: 'VIDEO_VERIFICATION_APPROVED',
    language: 'en',
    subject: 'Property Video Verified!',
    bodyText: `Hi {{name}},

Great news! Your property video has been verified and approved.

Your listing is one step closer to going live on LocalStays.

Thank you for helping us maintain high-quality listings!

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
  <title>Property Video Verified</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Video Verified</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Great news! Your property video has been verified and approved.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Your listing is one step closer to going live on LocalStays.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Thank you for helping us maintain high-quality listings!</p>
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
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_APPROVED',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_APPROVED',
    language: 'sr',
    subject: 'Video snimak nekretnine verifikovan!',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaš video snimak nekretnine je verifikovan i odobren.

Vaš oglas je korak bliže objavljivanju na LocalStays platformi.

Hvala vam što nam pomažete da održimo visok kvalitet oglasa!

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
  <title>Video snimak nekretnine verifikovan</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Video verifikovan</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Odlične vesti! Vaš video snimak nekretnine je verifikovan i odobren.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Vaš oglas je korak bliže objavljivanju na LocalStays platformi.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hvala vam što nam pomažete da održimo visok kvalitet oglasa!</p>
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
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 3. VIDEO_VERIFICATION_REJECTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REJECTED',
    sk: 'LANG#en',
    templateName: 'VIDEO_VERIFICATION_REJECTED',
    language: 'en',
    subject: 'Property Video Requires Resubmission',
    bodyText: `Hi {{name}},

Thank you for submitting your property video. Unfortunately, we cannot verify it at this time.

Reason:
{{reason}}

Please review the feedback and upload a new video that addresses the concerns mentioned above.

If you have questions, contact us at hello@localstays.me.

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
  <title>Property Video Requires Resubmission</title>
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
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⚠ Resubmission Required</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Thank you for submitting your property video. Unfortunately, we cannot verify it at this time.</p>
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Please review the feedback and upload a new video that addresses the concerns mentioned above.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">If you have questions, contact us at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.</p>
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REJECTED',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_REJECTED',
    language: 'sr',
    subject: 'Video snimak nekretnine zahteva ponovno slanje',
    bodyText: `Zdravo {{name}},

Hvala vam što ste poslali video snimak vaše nekretnine. Nažalost, trenutno ne možemo da ga verifikujemo.

Razlog:
{{reason}}

Molimo vas pregledajte povratne informacije i otpremite novi video koji rešava gore navedene probleme.

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
  <title>Video snimak nekretnine zahteva ponovno slanje</title>
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
                    <span style="color: #b45309; font-size: 14px; font-weight: 600;">⚠ Potrebno ponovno slanje</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hvala vam što ste poslali video snimak vaše nekretnine. Nažalost, trenutno ne možemo da ga verifikujemo.</p>
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Molimo vas pregledajte povratne informacije i otpremite novi video koji rešava gore navedene probleme.</p>
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 4. ADDRESS_VERIFICATION_REQUEST
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_REQUEST',
    sk: 'LANG#en',
    templateName: 'ADDRESS_VERIFICATION_REQUEST',
    language: 'en',
    subject: 'Address Verification Code on the Way',
    bodyText: `Hi {{name}},

We're sending a verification code by postal mail to your property address:
{{listingAddress}}

Once you receive the letter (usually within 5-7 business days), please enter the 6-character code in your LocalStays host account.

Go to Dashboard: {{dashboardUrl}}

This helps us verify that you have access to the property and that the address is correct.

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
  <title>Address Verification Code on the Way</title>
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
                  <td style="background-color: #eff6ff; padding: 8px 16px; border-radius: 20px; border: 1px solid #bfdbfe;">
                    <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">📬 Code on the Way</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">We're sending a verification code by postal mail to your property address:</p>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">{{listingAddress}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Once you receive the letter (usually within 5-7 business days), please enter the 6-character code in your LocalStays host account.</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Go to Dashboard</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">This helps us verify that you have access to the property and that the address is correct.</p>
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
    variables: ['name', 'listingAddress', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_REQUEST',
    sk: 'LANG#sr',
    templateName: 'ADDRESS_VERIFICATION_REQUEST',
    language: 'sr',
    subject: 'Verifikacioni kod za adresu je na putu',
    bodyText: `Zdravo {{name}},

Šaljemo vam verifikacioni kod poštom na adresu vaše nekretnine:
{{listingAddress}}

Kada primite pismo (obično u roku od 5-7 radnih dana), molimo vas unesite 6-karakterni kod u vašem LocalStays nalogu domaćina.

Idite na kontrolnu tablu: {{dashboardUrl}}

Ovo nam pomaže da verifikujemo da imate pristup nekretnini i da je adresa tačna.

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
  <title>Verifikacioni kod za adresu je na putu</title>
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
                  <td style="background-color: #eff6ff; padding: 8px 16px; border-radius: 20px; border: 1px solid #bfdbfe;">
                    <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">📬 Kod je na putu</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Šaljemo vam verifikacioni kod poštom na adresu vaše nekretnine:</p>
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">{{listingAddress}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Kada primite pismo (obično u roku od 5-7 radnih dana), molimo vas unesite 6-karakterni kod u vašem LocalStays nalogu domaćina.</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td style="background-color: #243447; border-radius: 8px;">
                    <a href="{{dashboardUrl}}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Idi na kontrolnu tablu</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Ovo nam pomaže da verifikujemo da imate pristup nekretnini i da je adresa tačna.</p>
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
    variables: ['name', 'listingAddress', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 5. ADDRESS_VERIFICATION_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_APPROVED',
    sk: 'LANG#en',
    templateName: 'ADDRESS_VERIFICATION_APPROVED',
    language: 'en',
    subject: 'Address Verified Successfully!',
    bodyText: `Hi {{name}},

Excellent! Your property address has been successfully verified.

Your listing is one step closer to going live on LocalStays.

Thank you for completing the verification process!

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
  <title>Address Verified Successfully</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Address Verified</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Excellent! Your property address has been successfully verified.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Your listing is one step closer to going live on LocalStays.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Thank you for completing the verification process!</p>
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
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_APPROVED',
    sk: 'LANG#sr',
    templateName: 'ADDRESS_VERIFICATION_APPROVED',
    language: 'sr',
    subject: 'Adresa uspešno verifikovana!',
    bodyText: `Zdravo {{name}},

Odlično! Adresa vaše nekretnine je uspešno verifikovana.

Vaš oglas je korak bliže objavljivanju na LocalStays platformi.

Hvala vam što ste završili proces verifikacije!

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
  <title>Adresa uspešno verifikovana</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Adresa verifikovana</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Odlično! Adresa vaše nekretnine je uspešno verifikovana.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Vaš oglas je korak bliže objavljivanju na LocalStays platformi.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hvala vam što ste završili proces verifikacije!</p>
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
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 6. ADDRESS_VERIFICATION_REJECTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_REJECTED',
    sk: 'LANG#en',
    templateName: 'ADDRESS_VERIFICATION_REJECTED',
    language: 'en',
    subject: 'Address Verification Failed',
    bodyText: `Hi {{name}},

Unfortunately, your address verification has failed due to too many incorrect code attempts.

Please contact our support team at hello@localstays.me to request a new verification code.

We're here to help if you have any questions.

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
  <title>Address Verification Failed</title>
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
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">✗ Verification Failed</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Hi {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Unfortunately, your address verification has failed due to too many incorrect code attempts.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Please contact our support team at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a> to request a new verification code.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">We're here to help if you have any questions.</p>
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
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_REJECTED',
    sk: 'LANG#sr',
    templateName: 'ADDRESS_VERIFICATION_REJECTED',
    language: 'sr',
    subject: 'Verifikacija adrese neuspešna',
    bodyText: `Zdravo {{name}},

Nažalost, vaša verifikacija adrese nije uspela zbog previše netačnih pokušaja unosa koda.

Molimo vas kontaktirajte našu podršku na hello@localstays.me da biste zatražili novi verifikacioni kod.

Tu smo da vam pomognemo ako imate bilo kakvih pitanja.

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
  <title>Verifikacija adrese neuspešna</title>
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
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">✗ Verifikacija neuspešna</span>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Zdravo {{name}},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Nažalost, vaša verifikacija adrese nije uspela zbog previše netačnih pokušaja unosa koda.</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">Molimo vas kontaktirajte našu podršku na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a> da biste zatražili novi verifikacioni kod.</p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">Tu smo da vam pomognemo ako imate bilo kakvih pitanja.</p>
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
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
];




