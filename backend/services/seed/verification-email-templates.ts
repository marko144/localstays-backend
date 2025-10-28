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

export const verificationEmailTemplates: EmailTemplateSeed[] = [
  // ========================================
  // 1. VIDEO_VERIFICATION_REQUEST
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REQUEST',
    sk: 'LANG#en',
    templateName: 'VIDEO_VERIFICATION_REQUEST',
    language: 'en',
    subject: 'Property Video Verification Required - LocalStays',
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

You can upload the video from your LocalStays host account under the property's verification requests section.

If you have any questions, contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>We need you to upload a video tour of your property at <strong>{{listingAddress}}</strong>.</p>
<p>This video verification helps us ensure the quality and accuracy of listings on LocalStays.</p>
<p><strong>What to include in your video:</strong></p>
<ul>
  <li>All rooms and living spaces</li>
  <li>Bathroom(s) and kitchen</li>
  <li>Outdoor areas (if applicable)</li>
  <li>Any amenities mentioned in your listing</li>
</ul>
<p><strong>Requirements:</strong></p>
<ul>
  <li>Maximum file size: 200MB</li>
  <li>Supported formats: MP4, MOV, WebM</li>
  <li>Duration: 2-5 minutes recommended</li>
</ul>
<p>You can upload the video from your LocalStays host account under the property's verification requests section.</p>
<p>If you have any questions, contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REQUEST',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_REQUEST',
    language: 'sr',
    subject: 'Potrebna verifikacija video snimka nekretnine - LocalStays',
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

Možete otpremiti video iz vašeg LocalStays naloga domaćina u delu sa zahtevima za verifikaciju nekretnine.

Ako imate pitanja, kontaktirajte našu podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Potrebno je da otpremite video snimak vaše nekretnine na adresi <strong>{{listingAddress}}</strong>.</p>
<p>Ova video verifikacija nam pomaže da osiguramo kvalitet i tačnost oglasa na LocalStays platformi.</p>
<p><strong>Šta treba da uključite u video snimak:</strong></p>
<ul>
  <li>Sve sobe i dnevne prostore</li>
  <li>Kupatilo(a) i kuhinju</li>
  <li>Spoljne prostore (ako postoje)</li>
  <li>Sve sadržaje navedene u vašem oglasu</li>
</ul>
<p><strong>Zahtevi:</strong></p>
<ul>
  <li>Maksimalna veličina fajla: 200MB</li>
  <li>Podržani formati: MP4, MOV, WebM</li>
  <li>Trajanje: preporučuje se 2-5 minuta</li>
</ul>
<p>Možete otpremiti video iz vašeg LocalStays naloga domaćina u delu sa zahtevima za verifikaciju nekretnine.</p>
<p>Ako imate pitanja, kontaktirajte našu podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'listingAddress'],
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
    subject: 'Property Video Verified! - LocalStays',
    bodyText: `Hi {{name}},

Great news! Your property video has been verified and approved.

Your listing is one step closer to going live on LocalStays.

Thank you for helping us maintain high-quality listings!

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Great news! Your property video has been verified and approved.</p>
<p>Your listing is one step closer to going live on LocalStays.</p>
<p>Thank you for helping us maintain high-quality listings!</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_APPROVED',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_APPROVED',
    language: 'sr',
    subject: 'Video snimak nekretnine verifikovan! - LocalStays',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaš video snimak nekretnine je verifikovan i odobren.

Vaš oglas je korak bliže objavljivanju na LocalStays platformi.

Hvala vam što nam pomažete da održimo visok kvalitet oglasa!

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Odlične vesti! Vaš video snimak nekretnine je verifikovan i odobren.</p>
<p>Vaš oglas je korak bliže objavljivanju na LocalStays platformi.</p>
<p>Hvala vam što nam pomažete da održimo visok kvalitet oglasa!</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'Property Video Requires Resubmission - LocalStays',
    bodyText: `Hi {{name}},

Thank you for submitting your property video. Unfortunately, we cannot verify it at this time.

Reason:
{{reason}}

Please review the feedback and upload a new video that addresses the concerns mentioned above. You can resubmit the video from your LocalStays host account.

If you have questions, contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Thank you for submitting your property video. Unfortunately, we cannot verify it at this time.</p>
<p><strong>Reason:</strong><br>
{{reason}}</p>
<p>Please review the feedback and upload a new video that addresses the concerns mentioned above. You can resubmit the video from your LocalStays host account.</p>
<p>If you have questions, contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#VIDEO_VERIFICATION_REJECTED',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_REJECTED',
    language: 'sr',
    subject: 'Video snimak nekretnine zahteva ponovno slanje - LocalStays',
    bodyText: `Zdravo {{name}},

Hvala vam što ste poslali video snimak vaše nekretnine. Nažalost, trenutno ne možemo da ga verifikujemo.

Razlog:
{{reason}}

Molimo vas pregledajte povratne informacije i otpremite novi video koji rešava gore navedene probleme. Možete ponovo poslati video iz vašeg LocalStays naloga domaćina.

Ako imate pitanja, kontaktirajte našu podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Hvala vam što ste poslali video snimak vaše nekretnine. Nažalost, trenutno ne možemo da ga verifikujemo.</p>
<p><strong>Razlog:</strong><br>
{{reason}}</p>
<p>Molimo vas pregledajte povratne informacije i otpremite novi video koji rešava gore navedene probleme. Možete ponovo poslati video iz vašeg LocalStays naloga domaćina.</p>
<p>Ako imate pitanja, kontaktirajte našu podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'Address Verification Code on the Way - LocalStays',
    bodyText: `Hi {{name}},

We're sending a verification code by postal mail to your property address:
{{listingAddress}}

Once you receive the letter (usually within 5-7 business days), please enter the 6-character code in your LocalStays host account under the property's verification requests section.

This helps us verify that you have access to the property and that the address is correct.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>We're sending a verification code by postal mail to your property address:<br>
<strong>{{listingAddress}}</strong></p>
<p>Once you receive the letter (usually within 5-7 business days), please enter the 6-character code in your LocalStays host account under the property's verification requests section.</p>
<p>This helps us verify that you have access to the property and that the address is correct.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_REQUEST',
    sk: 'LANG#sr',
    templateName: 'ADDRESS_VERIFICATION_REQUEST',
    language: 'sr',
    subject: 'Verifikacioni kod za adresu je na putu - LocalStays',
    bodyText: `Zdravo {{name}},

Šaljemo vam verifikacioni kod poštom na adresu vaše nekretnine:
{{listingAddress}}

Kada primite pismo (obično u roku od 5-7 radnih dana), molimo vas unesite 6-karakterni kod u vašem LocalStays nalogu domaćina u delu sa zahtevima za verifikaciju nekretnine.

Ovo nam pomaže da verifikujemo da imate pristup nekretnini i da je adresa tačna.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Šaljemo vam verifikacioni kod poštom na adresu vaše nekretnine:<br>
<strong>{{listingAddress}}</strong></p>
<p>Kada primite pismo (obično u roku od 5-7 radnih dana), molimo vas unesite 6-karakterni kod u vašem LocalStays nalogu domaćina u delu sa zahtevima za verifikaciju nekretnine.</p>
<p>Ovo nam pomaže da verifikujemo da imate pristup nekretnini i da je adresa tačna.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'listingAddress'],
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
    subject: 'Address Verified Successfully! - LocalStays',
    bodyText: `Hi {{name}},

Excellent! Your property address has been successfully verified.

Your listing is one step closer to going live on LocalStays.

Thank you for completing the verification process!

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Excellent! Your property address has been successfully verified.</p>
<p>Your listing is one step closer to going live on LocalStays.</p>
<p>Thank you for completing the verification process!</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingAddress'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_APPROVED',
    sk: 'LANG#sr',
    templateName: 'ADDRESS_VERIFICATION_APPROVED',
    language: 'sr',
    subject: 'Adresa uspešno verifikovana! - LocalStays',
    bodyText: `Zdravo {{name}},

Odlično! Adresa vaše nekretnine je uspešno verifikovana.

Vaš oglas je korak bliže objavljivanju na LocalStays platformi.

Hvala vam što ste završili proces verifikacije!

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Odlično! Adresa vaše nekretnine je uspešno verifikovana.</p>
<p>Vaš oglas je korak bliže objavljivanju na LocalStays platformi.</p>
<p>Hvala vam što ste završili proces verifikacije!</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'Address Verification Failed - LocalStays',
    bodyText: `Hi {{name}},

Unfortunately, your address verification has failed due to too many incorrect code attempts.

Please contact our support team to request a new verification code.

We're here to help if you have any questions.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Unfortunately, your address verification has failed due to too many incorrect code attempts.</p>
<p>Please contact our support team to request a new verification code.</p>
<p>We're here to help if you have any questions.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADDRESS_VERIFICATION_REJECTED',
    sk: 'LANG#sr',
    templateName: 'ADDRESS_VERIFICATION_REJECTED',
    language: 'sr',
    subject: 'Verifikacija adrese neuspešna - LocalStays',
    bodyText: `Zdravo {{name}},

Nažalost, vaša verifikacija adrese nije uspela zbog previše netačnih pokušaja unosa koda.

Molimo vas kontaktirajte našu podršku da biste zatražili novi verifikacioni kod.

Tu smo da vam pomognemo ako imate bilo kakvih pitanja.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Nažalost, vaša verifikacija adrese nije uspela zbog previše netačnih pokušaja unosa koda.</p>
<p>Molimo vas kontaktirajte našu podršku da biste zatražili novi verifikacioni kod.</p>
<p>Tu smo da vam pomognemo ako imate bilo kakvih pitanja.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
];




