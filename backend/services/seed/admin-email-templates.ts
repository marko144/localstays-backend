/**
 * Admin Email Templates Seed Data
 * Contains all 9 admin action email templates in English and Serbian
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

export const adminEmailTemplates: EmailTemplateSeed[] = [
  // ========================================
  // 1. HOST_PROFILE_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_APPROVED',
    sk: 'LANG#en',
    templateName: 'HOST_PROFILE_APPROVED',
    language: 'en',
    subject: 'Your Host Profile Has Been Approved!',
    bodyText: `Hi {{name}},

Great news! Your host profile has been approved.

You can now create and submit property listings on LocalStays.

Welcome to the LocalStays community!

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
  <title>Host Profile Approved</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Profile Approved</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Great news! Your host profile has been approved.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                You can now create and submit property listings on LocalStays.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151; font-weight: 500;">
                Welcome to the LocalStays community!
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
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_APPROVED',
    sk: 'LANG#sr',
    templateName: 'HOST_PROFILE_APPROVED',
    language: 'sr',
    subject: 'Vaš profil domaćina je odobren!',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaš profil domaćina je odobren.

Sada možete kreirati i poslati oglase za nekretnine na LocalStays.

Dobrodošli u LocalStays zajednicu!

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
  <title>Profil domaćina odobren</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Profil odobren</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Odlične vesti! Vaš profil domaćina je odobren.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Sada možete kreirati i poslati oglase za nekretnine na LocalStays.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151; font-weight: 500;">
                Dobrodošli u LocalStays zajednicu!
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
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 2. HOST_PROFILE_REJECTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_REJECTED',
    sk: 'LANG#en',
    templateName: 'HOST_PROFILE_REJECTED',
    language: 'en',
    subject: 'Host Profile - Action Required',
    bodyText: `Hi {{name}},

Thank you for submitting your host profile. Unfortunately, we cannot approve it at this time.

Reason:
{{reason}}

Please review the feedback, update your profile with the required information, and resubmit for review.

If you have questions, contact our support team at hello@localstays.me.

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
  <title>Host Profile - Action Required</title>
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
                Thank you for submitting your host profile. Unfortunately, we cannot approve it at this time.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Please review the feedback, update your profile with the required information, and resubmit for review.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                If you have questions, contact our support team at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_REJECTED',
    sk: 'LANG#sr',
    templateName: 'HOST_PROFILE_REJECTED',
    language: 'sr',
    subject: 'Profil domaćina - Potrebna akcija',
    bodyText: `Zdravo {{name}},

Hvala što ste poslali svoj profil domaćina. Nažalost, trenutno ne možemo da ga odobrimo.

Razlog:
{{reason}}

Molimo pregledajte povratne informacije, ažurirajte svoj profil sa potrebnim informacijama i ponovo pošaljite na pregled.

Ako imate pitanja, kontaktirajte naš tim za podršku na hello@localstays.me.

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
  <title>Profil domaćina - Potrebna akcija</title>
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
                Hvala što ste poslali svoj profil domaćina. Nažalost, trenutno ne možemo da ga odobrimo.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Molimo pregledajte povratne informacije, ažurirajte svoj profil sa potrebnim informacijama i ponovo pošaljite na pregled.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Ako imate pitanja, kontaktirajte naš tim za podršku na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 3. HOST_SUSPENDED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#HOST_SUSPENDED',
    sk: 'LANG#en',
    templateName: 'HOST_SUSPENDED',
    language: 'en',
    subject: 'Important: Your Account Has Been Suspended',
    bodyText: `Hi {{name}},

Your LocalStays host account has been suspended.

Reason:
{{reason}}

All your listings have been taken offline. You will not be able to accept bookings until this matter is resolved.

To appeal this decision or discuss reinstatement, please contact our support team immediately at hello@localstays.me.

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
  <title>Account Suspended</title>
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
              <!-- Alert Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef2f2; padding: 8px 16px; border-radius: 20px; border: 1px solid #fecaca;">
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">⊘ Account Suspended</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your LocalStays host account has been suspended.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                All your listings have been taken offline. You will not be able to accept bookings until this matter is resolved.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                To appeal this decision or discuss reinstatement, please contact our support team immediately at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_SUSPENDED',
    sk: 'LANG#sr',
    templateName: 'HOST_SUSPENDED',
    language: 'sr',
    subject: 'Važno: Vaš nalog je suspendovan',
    bodyText: `Zdravo {{name}},

Vaš LocalStays nalog domaćina je suspendovan.

Razlog:
{{reason}}

Svi vaši oglasi su uklonjeni sa mreže. Nećete moći da prihvatate rezervacije dok se ovaj problem ne reši.

Da biste osporili ovu odluku ili razgovarali o ponovnoj aktivaciji, molimo kontaktirajte naš tim za podršku odmah na hello@localstays.me.

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
  <title>Nalog suspendovan</title>
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
              <!-- Alert Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef2f2; padding: 8px 16px; border-radius: 20px; border: 1px solid #fecaca;">
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">⊘ Nalog suspendovan</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Vaš LocalStays nalog domaćina je suspendovan.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Svi vaši oglasi su uklonjeni sa mreže. Nećete moći da prihvatate rezervacije dok se ovaj problem ne reši.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Da biste osporili ovu odluku ili razgovarali o ponovnoj aktivaciji, molimo kontaktirajte naš tim za podršku odmah na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 4. HOST_REINSTATED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#HOST_REINSTATED',
    sk: 'LANG#en',
    templateName: 'HOST_REINSTATED',
    language: 'en',
    subject: 'Your Account Has Been Reinstated',
    bodyText: `Hi {{name}},

Good news! Your LocalStays host account has been reinstated.

All account features have been restored and you can set your listings online again.

Thank you for your cooperation in resolving this matter.

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
  <title>Account Reinstated</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Account Reinstated</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Good news! Your LocalStays host account has been reinstated.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                All account features have been restored and you can set your listings online again.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for your cooperation in resolving this matter.
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
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_REINSTATED',
    sk: 'LANG#sr',
    templateName: 'HOST_REINSTATED',
    language: 'sr',
    subject: 'Vaš nalog je ponovo aktiviran',
    bodyText: `Zdravo {{name}},

Dobre vesti! Vaš LocalStays nalog domaćina je ponovo aktiviran.

Sve funkcije naloga su vraćene i možete ponovo postaviti svoje oglase na mrežu.

Hvala na saradnji u rešavanju ovog pitanja.

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
  <title>Nalog ponovo aktiviran</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Nalog aktiviran</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Dobre vesti! Vaš LocalStays nalog domaćina je ponovo aktiviran.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Sve funkcije naloga su vraćene i možete ponovo postaviti svoje oglase na mrežu.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala na saradnji u rešavanju ovog pitanja.
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
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 5. LISTING_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_APPROVED',
    sk: 'LANG#en',
    templateName: 'LISTING_APPROVED',
    language: 'en',
    subject: 'Your Listing "{{listingName}}" Has Been Approved!',
    bodyText: `Hi {{name}},

Great news! Your listing "{{listingName}}" has been approved.

You can now publish it to start receiving booking requests from guests.

Log in to your dashboard to set your listing live.

Best of luck with your bookings!

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
  <title>Listing Approved</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Approved</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Great news! Your listing <strong style="color: #111827;">"{{listingName}}"</strong> has been approved.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                You can now publish it to start receiving booking requests from guests.
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
                Best of luck with your bookings!
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
    variables: ['name', 'listingName', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_APPROVED',
    sk: 'LANG#sr',
    templateName: 'LISTING_APPROVED',
    language: 'sr',
    subject: 'Vaš oglas "{{listingName}}" je odobren!',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaš oglas "{{listingName}}" je odobren.

Sada možete da ga objavite i počnete da primate zahteve za rezervacije od gostiju.

Prijavite se na svoj dashboard da postavite oglas uživo.

Srećno sa rezervacijama!

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
  <title>Oglas odobren</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Odobreno</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Odlične vesti! Vaš oglas <strong style="color: #111827;">"{{listingName}}"</strong> je odobren.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Sada možete da ga objavite i počnete da primate zahteve za rezervacije od gostiju.
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
                Srećno sa rezervacijama!
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
    variables: ['name', 'listingName', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 5b. LISTING_PUBLISHED (NEW)
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_PUBLISHED',
    sk: 'LANG#en',
    templateName: 'LISTING_PUBLISHED',
    language: 'en',
    subject: 'Your Listing "{{listingName}}" Is Now Live!',
    bodyText: `Hi {{name}},

Congratulations! Your listing "{{listingName}}" is now live and visible to guests.

Travelers searching for accommodations in your area can now discover and book your property.

Make sure your calendar is up to date to avoid any booking conflicts.

Best of luck with your bookings!

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
  <title>Listing Published</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">🎉 Now Live</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Congratulations! Your listing <strong style="color: #111827;">"{{listingName}}"</strong> is now live and visible to guests.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Travelers searching for accommodations in your area can now discover and book your property.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Make sure your calendar is up to date to avoid any booking conflicts.
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
                Best of luck with your bookings!
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
    variables: ['name', 'listingName', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_PUBLISHED',
    sk: 'LANG#sr',
    templateName: 'LISTING_PUBLISHED',
    language: 'sr',
    subject: 'Vaš oglas "{{listingName}}" je sada aktivan!',
    bodyText: `Zdravo {{name}},

Čestitamo! Vaš oglas "{{listingName}}" je sada aktivan i vidljiv gostima.

Putnici koji traže smeštaj u vašem području sada mogu pronaći i rezervisati vašu nekretninu.

Pobrinite se da je vaš kalendar ažuriran kako biste izbegli konflikte sa rezervacijama.

Srećno sa rezervacijama!

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
  <title>Oglas objavljen</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">🎉 Sada aktivan</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Čestitamo! Vaš oglas <strong style="color: #111827;">"{{listingName}}"</strong> je sada aktivan i vidljiv gostima.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Putnici koji traže smeštaj u vašem području sada mogu pronaći i rezervisati vašu nekretninu.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Pobrinite se da je vaš kalendar ažuriran kako biste izbegli konflikte sa rezervacijama.
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
                Srećno sa rezervacijama!
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
    variables: ['name', 'listingName', 'dashboardUrl'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 6. LISTING_REJECTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_REJECTED',
    sk: 'LANG#en',
    templateName: 'LISTING_REJECTED',
    language: 'en',
    subject: 'Listing "{{listingName}}" - Action Required',
    bodyText: `Hi {{name}},

Your listing "{{listingName}}" could not be approved at this time.

Reason:
{{reason}}

Please review the feedback, make the necessary changes to your listing, and resubmit it for review.

If you need assistance, contact our support team at hello@localstays.me.

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
  <title>Listing - Action Required</title>
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
                Your listing <strong style="color: #111827;">"{{listingName}}"</strong> could not be approved at this time.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Please review the feedback, make the necessary changes to your listing, and resubmit it for review.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                If you need assistance, contact our support team at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'listingName', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_REJECTED',
    sk: 'LANG#sr',
    templateName: 'LISTING_REJECTED',
    language: 'sr',
    subject: 'Oglas "{{listingName}}" - Potrebna akcija',
    bodyText: `Zdravo {{name}},

Vaš oglas "{{listingName}}" trenutno ne može biti odobren.

Razlog:
{{reason}}

Molimo pregledajte povratne informacije, napravite potrebne izmene u svom oglasu i ponovo ga pošaljite na pregled.

Ako vam je potrebna pomoć, kontaktirajte naš tim za podršku na hello@localstays.me.

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
  <title>Oglas - Potrebna akcija</title>
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
                Vaš oglas <strong style="color: #111827;">"{{listingName}}"</strong> trenutno ne može biti odobren.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Molimo pregledajte povratne informacije, napravite potrebne izmene u svom oglasu i ponovo ga pošaljite na pregled.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Ako vam je potrebna pomoć, kontaktirajte naš tim za podršku na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'listingName', 'reason'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 7. LISTING_SUSPENDED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_SUSPENDED',
    sk: 'LANG#en',
    templateName: 'LISTING_SUSPENDED',
    language: 'en',
    subject: 'Important: Listing "{{listingName}}" Has Been Suspended',
    bodyText: `Hi {{name}},

Your listing "{{listingName}}" has been suspended and taken offline.

Reason:
{{reason}}

The listing is no longer visible to guests and cannot receive bookings. To resolve this issue, please contact our support team at hello@localstays.me.

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
  <title>Listing Suspended</title>
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
              <!-- Alert Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef2f2; padding: 8px 16px; border-radius: 20px; border: 1px solid #fecaca;">
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">⊘ Listing Suspended</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your listing <strong style="color: #111827;">"{{listingName}}"</strong> has been suspended and taken offline.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                The listing is no longer visible to guests and cannot receive bookings. To resolve this issue, please contact our support team at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'listingName', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_SUSPENDED',
    sk: 'LANG#sr',
    templateName: 'LISTING_SUSPENDED',
    language: 'sr',
    subject: 'Važno: Oglas "{{listingName}}" je suspendovan',
    bodyText: `Zdravo {{name}},

Vaš oglas "{{listingName}}" je suspendovan i uklonjen sa mreže.

Razlog:
{{reason}}

Oglas više nije vidljiv gostima i ne može primati rezervacije. Da biste rešili ovaj problem, molimo kontaktirajte naš tim za podršku na hello@localstays.me.

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
  <title>Oglas suspendovan</title>
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
              <!-- Alert Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef2f2; padding: 8px 16px; border-radius: 20px; border: 1px solid #fecaca;">
                    <span style="color: #dc2626; font-size: 14px; font-weight: 600;">⊘ Oglas suspendovan</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Vaš oglas <strong style="color: #111827;">"{{listingName}}"</strong> je suspendovan i uklonjen sa mreže.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Oglas više nije vidljiv gostima i ne može primati rezervacije. Da biste rešili ovaj problem, molimo kontaktirajte naš tim za podršku na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'listingName', 'reason'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 8. REQUEST_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#REQUEST_APPROVED',
    sk: 'LANG#en',
    templateName: 'REQUEST_APPROVED',
    language: 'en',
    subject: 'Your Live ID Verification Has Been Approved',
    bodyText: `Hi {{name}},

Your Live ID verification has been successfully approved!

Your host account verification is now complete. Thank you for helping us maintain a safe and trusted community.

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
  <title>Live ID Verification Approved</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Verified</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your Live ID verification has been successfully approved!
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your host account verification is now complete. Thank you for helping us maintain a safe and trusted community.
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
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#REQUEST_APPROVED',
    sk: 'LANG#sr',
    templateName: 'REQUEST_APPROVED',
    language: 'sr',
    subject: 'Vaša Live ID verifikacija je odobrena',
    bodyText: `Zdravo {{name}},

Vaša Live ID verifikacija je uspešno odobrena!

Verifikacija vašeg naloga domaćina je sada završena. Hvala što nam pomažete da održimo bezbednu zajednicu od poverenja.

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
  <title>Live ID verifikacija odobrena</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Verifikovano</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Vaša Live ID verifikacija je uspešno odobrena!
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Verifikacija vašeg naloga domaćina je sada završena. Hvala što nam pomažete da održimo bezbednu zajednicu od poverenja.
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
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 9. REQUEST_REJECTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#REQUEST_REJECTED',
    sk: 'LANG#en',
    templateName: 'REQUEST_REJECTED',
    language: 'en',
    subject: 'Live ID Verification - Action Required',
    bodyText: `Hi {{name}},

We were unable to approve your Live ID verification submission.

Reason:
{{reason}}

Please submit a new Live ID video from your LocalStays host account that addresses the feedback provided.

If you have questions about the requirements, contact our support team at hello@localstays.me.

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
  <title>Live ID Verification - Action Required</title>
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
                We were unable to approve your Live ID verification submission.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Please submit a new Live ID video from your LocalStays host account that addresses the feedback provided.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                If you have questions about the requirements, contact our support team at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#REQUEST_REJECTED',
    sk: 'LANG#sr',
    templateName: 'REQUEST_REJECTED',
    language: 'sr',
    subject: 'Live ID verifikacija - Potrebna akcija',
    bodyText: `Zdravo {{name}},

Nismo mogli da odobrimo vašu Live ID verifikaciju.

Razlog:
{{reason}}

Molimo pošaljite novi Live ID video iz vašeg LocalStays naloga domaćina koji uzima u obzir date povratne informacije.

Ako imate pitanja o zahtevima, kontaktirajte naš tim za podršku na hello@localstays.me.

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
  <title>Live ID verifikacija - Potrebna akcija</title>
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
                Nismo mogli da odobrimo vašu Live ID verifikaciju.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Molimo pošaljite novi Live ID video iz vašeg LocalStays naloga domaćina koji uzima u obzir date povratne informacije.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Ako imate pitanja o zahtevima, kontaktirajte naš tim za podršku na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 10. LISTING_IMAGE_UPDATE_SUBMITTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_IMAGE_UPDATE_SUBMITTED',
    sk: 'LANG#en',
    templateName: 'LISTING_IMAGE_UPDATE_SUBMITTED',
    language: 'en',
    subject: 'Image Update Request Received for "{{listingName}}"',
    bodyText: `Hi {{name}},

We've received your request to update images for your listing "{{listingName}}".

Our team will review your changes and notify you once the review is complete. This typically takes 1-2 business days.

Thank you for keeping your listing up to date!

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
  <title>Image Update Request Received</title>
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
                    <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">📷 Request Received</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                We've received your request to update images for your listing <strong style="color: #111827;">"{{listingName}}"</strong>.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Our team will review your changes and notify you once the review is complete. This typically takes 1-2 business days.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for keeping your listing up to date!
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
    variables: ['name', 'listingName'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_IMAGE_UPDATE_SUBMITTED',
    sk: 'LANG#sr',
    templateName: 'LISTING_IMAGE_UPDATE_SUBMITTED',
    language: 'sr',
    subject: 'Zahtev za ažuriranje slika primljen za "{{listingName}}"',
    bodyText: `Zdravo {{name}},

Primili smo vaš zahtev za ažuriranje slika za vaš oglas "{{listingName}}".

Naš tim će pregledati vaše izmene i obavestiti vas kada pregled bude završen. Ovo obično traje 1-2 radna dana.

Hvala što održavate svoj oglas ažurnim!

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
  <title>Zahtev za ažuriranje slika primljen</title>
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
                    <span style="color: #1d4ed8; font-size: 14px; font-weight: 600;">📷 Zahtev primljen</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Primili smo vaš zahtev za ažuriranje slika za vaš oglas <strong style="color: #111827;">"{{listingName}}"</strong>.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Naš tim će pregledati vaše izmene i obavestiti vas kada pregled bude završen. Ovo obično traje 1-2 radna dana.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala što održavate svoj oglas ažurnim!
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
    variables: ['name', 'listingName'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 11. LISTING_IMAGE_UPDATE_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_IMAGE_UPDATE_APPROVED',
    sk: 'LANG#en',
    templateName: 'LISTING_IMAGE_UPDATE_APPROVED',
    language: 'en',
    subject: 'Image Updates Approved for "{{listingName}}"',
    bodyText: `Hi {{name}},

Great news! Your image updates for "{{listingName}}" have been approved.

The changes are now live on your listing and visible to guests.

Thank you for keeping your listing fresh and accurate!

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
  <title>Image Updates Approved</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Images Approved</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Great news! Your image updates for <strong style="color: #111827;">"{{listingName}}"</strong> have been approved.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                The changes are now live on your listing and visible to guests.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for keeping your listing fresh and accurate!
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
    variables: ['name', 'listingName'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_IMAGE_UPDATE_APPROVED',
    sk: 'LANG#sr',
    templateName: 'LISTING_IMAGE_UPDATE_APPROVED',
    language: 'sr',
    subject: 'Ažuriranje slika odobreno za "{{listingName}}"',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaše izmene slika za "{{listingName}}" su odobrene.

Izmene su sada aktivne na vašem oglasu i vidljive gostima.

Hvala što održavate svoj oglas svežim i tačnim!

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
  <title>Ažuriranje slika odobreno</title>
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
                    <span style="color: #059669; font-size: 14px; font-weight: 600;">✓ Slike odobrene</span>
                  </td>
                </tr>
              </table>
              <!-- Greeting -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Zdravo {{name}},
              </p>
              <!-- Main Message -->
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Odlične vesti! Vaše izmene slika za <strong style="color: #111827;">"{{listingName}}"</strong> su odobrene.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Izmene su sada aktivne na vašem oglasu i vidljive gostima.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Hvala što održavate svoj oglas svežim i tačnim!
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
    variables: ['name', 'listingName'],
    createdAt: now,
    updatedAt: now,
  },

  // ========================================
  // 12. LISTING_IMAGE_UPDATE_REJECTED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#LISTING_IMAGE_UPDATE_REJECTED',
    sk: 'LANG#en',
    templateName: 'LISTING_IMAGE_UPDATE_REJECTED',
    language: 'en',
    subject: 'Image Update Request for "{{listingName}}" - Action Required',
    bodyText: `Hi {{name}},

We were unable to approve your image update request for "{{listingName}}".

Reason:
{{reason}}

Your listing images remain unchanged. Please review the feedback and submit a new image update request that addresses the concerns.

If you need assistance, contact our support team at hello@localstays.me.

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
  <title>Image Update - Action Required</title>
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
                We were unable to approve your image update request for <strong style="color: #111827;">"{{listingName}}"</strong>.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Reason:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Your listing images remain unchanged. Please review the feedback and submit a new image update request that addresses the concerns.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                If you need assistance, contact our support team at <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'listingName', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#LISTING_IMAGE_UPDATE_REJECTED',
    sk: 'LANG#sr',
    templateName: 'LISTING_IMAGE_UPDATE_REJECTED',
    language: 'sr',
    subject: 'Zahtev za ažuriranje slika za "{{listingName}}" - Potrebna akcija',
    bodyText: `Zdravo {{name}},

Nismo mogli da odobrimo vaš zahtev za ažuriranje slika za "{{listingName}}".

Razlog:
{{reason}}

Slike vašeg oglasa ostaju nepromenjene. Molimo pregledajte povratne informacije i pošaljite novi zahtev za ažuriranje slika koji uzima u obzir date komentare.

Ako vam je potrebna pomoć, kontaktirajte naš tim za podršku na hello@localstays.me.

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
  <title>Ažuriranje slika - Potrebna akcija</title>
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
                Nismo mogli da odobrimo vaš zahtev za ažuriranje slika za <strong style="color: #111827;">"{{listingName}}"</strong>.
              </p>
              <!-- Reason Box -->
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">Razlog:</p>
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #7f1d1d;">{{reason}}</p>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Slike vašeg oglasa ostaju nepromenjene. Molimo pregledajte povratne informacije i pošaljite novi zahtev za ažuriranje slika koji uzima u obzir date komentare.
              </p>
              <p style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                Ako vam je potrebna pomoć, kontaktirajte naš tim za podršku na <a href="mailto:hello@localstays.me" style="color: #243447; text-decoration: underline;">hello@localstays.me</a>.
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
    variables: ['name', 'listingName', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
];















