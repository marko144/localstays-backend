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

export const adminEmailTemplates: EmailTemplateSeed[] = [
  // ========================================
  // 1. HOST_PROFILE_APPROVED
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_APPROVED',
    sk: 'LANG#en',
    templateName: 'HOST_PROFILE_APPROVED',
    language: 'en',
    subject: 'Your LocalStays Host Profile Has Been Approved! 🎉',
    bodyText: `Hi {{name}},

Great news! Your host profile has been approved.

You can now create and submit property listings on LocalStays.

Welcome to the LocalStays community!

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Great news! Your host profile has been approved.</p>
<p>You can now create and submit property listings on LocalStays.</p>
<p>Welcome to the LocalStays community!</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_APPROVED',
    sk: 'LANG#sr',
    templateName: 'HOST_PROFILE_APPROVED',
    language: 'sr',
    subject: 'Vaš LocalStays profil domaćina je odobren! 🎉',
    bodyText: `Zdravo {{name}},

Odlične vesti! Vaš profil domaćina je odobren.

Sada možete kreirati i poslati oglase za nekretnine na LocalStays.

Dobrodošli u LocalStays zajednicu!

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Odlične vesti! Vaš profil domaćina je odobren.</p>
<p>Sada možete kreirati i poslati oglase za nekretnine na LocalStays.</p>
<p>Dobrodošli u LocalStays zajednicu!</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'LocalStays Host Profile - Action Required',
    bodyText: `Hi {{name}},

Thank you for submitting your host profile. Unfortunately, we cannot approve it at this time.

Reason:
{{reason}}

Please review the feedback, update your profile with the required information, and resubmit for review.

If you have questions, contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Thank you for submitting your host profile. Unfortunately, we cannot approve it at this time.</p>
<p><strong>Reason:</strong><br>{{reason}}</p>
<p>Please review the feedback, update your profile with the required information, and resubmit for review.</p>
<p>If you have questions, contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_PROFILE_REJECTED',
    sk: 'LANG#sr',
    templateName: 'HOST_PROFILE_REJECTED',
    language: 'sr',
    subject: 'LocalStays profil domaćina - Potrebna akcija',
    bodyText: `Zdravo {{name}},

Hvala što ste poslali svoj profil domaćina. Nažalost, trenutno ne možemo da ga odobrimo.

Razlog:
{{reason}}

Molimo pregledajte povratne informacije, ažurirajte svoj profil sa potrebnim informacijama i ponovo pošaljite na pregled.

Ako imate pitanja, kontaktirajte naš tim za podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Hvala što ste poslali svoj profil domaćina. Nažalost, trenutno ne možemo da ga odobrimo.</p>
<p><strong>Razlog:</strong><br>{{reason}}</p>
<p>Molimo pregledajte povratne informacije, ažurirajte svoj profil sa potrebnim informacijama i ponovo pošaljite na pregled.</p>
<p>Ako imate pitanja, kontaktirajte naš tim za podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'Important: Your LocalStays Account Has Been Suspended',
    bodyText: `Hi {{name}},

Your LocalStays host account has been suspended.

Reason:
{{reason}}

All your listings have been taken offline. You will not be able to accept bookings until this matter is resolved.

To appeal this decision or discuss reinstatement, please contact our support team immediately.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your LocalStays host account has been suspended.</p>
<p><strong>Reason:</strong><br>{{reason}}</p>
<p>All your listings have been taken offline. You will not be able to accept bookings until this matter is resolved.</p>
<p>To appeal this decision or discuss reinstatement, please contact our support team immediately.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_SUSPENDED',
    sk: 'LANG#sr',
    templateName: 'HOST_SUSPENDED',
    language: 'sr',
    subject: 'Važno: Vaš LocalStays nalog je suspendovan',
    bodyText: `Zdravo {{name}},

Vaš LocalStays nalog domaćina je suspendovan.

Razlog:
{{reason}}

Svi vaši oglasi su uklonjeni sa mreže. Nećete moći da prihvatate rezervacije dok se ovaj problem ne reši.

Da biste osporili ovu odluku ili razgovarali o ponovnoj aktivaciji, molimo kontaktirajte naš tim za podršku odmah.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaš LocalStays nalog domaćina je suspendovan.</p>
<p><strong>Razlog:</strong><br>{{reason}}</p>
<p>Svi vaši oglasi su uklonjeni sa mreže. Nećete moći da prihvatate rezervacije dok se ovaj problem ne reši.</p>
<p>Da biste osporili ovu odluku ili razgovarali o ponovnoj aktivaciji, molimo kontaktirajte naš tim za podršku odmah.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'Your LocalStays Account Has Been Reinstated',
    bodyText: `Hi {{name}},

Good news! Your LocalStays host account has been reinstated.

All account features have been restored and you can set your listings online again.

Thank you for your cooperation in resolving this matter.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Good news! Your LocalStays host account has been reinstated.</p>
<p>All account features have been restored and you can set your listings online again.</p>
<p>Thank you for your cooperation in resolving this matter.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#HOST_REINSTATED',
    sk: 'LANG#sr',
    templateName: 'HOST_REINSTATED',
    language: 'sr',
    subject: 'Vaš LocalStays nalog je ponovo aktiviran',
    bodyText: `Zdravo {{name}},

Dobre vesti! Vaš LocalStays nalog domaćina je ponovo aktiviran.

Sve funkcije naloga su vraćene i možete ponovo postaviti svoje oglase na mrežu.

Hvala na saradnji u rešavanju ovog pitanja.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Dobre vesti! Vaš LocalStays nalog domaćina je ponovo aktiviran.</p>
<p>Sve funkcije naloga su vraćene i možete ponovo postaviti svoje oglase na mrežu.</p>
<p>Hvala na saradnji u rešavanju ovog pitanja.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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

Your listing "{{listingName}}" has been approved!

You can now set it online to start receiving booking requests.

Best of luck with your bookings!

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your listing "<strong>{{listingName}}</strong>" has been approved!</p>
<p>You can now set it online to start receiving booking requests.</p>
<p>Best of luck with your bookings!</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingName'],
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

Vaš oglas "{{listingName}}" je odobren!

Sada možete da ga postavite na mrežu i počnete da primate zahteve za rezervacije.

Srećno sa rezervacijama!

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaš oglas "<strong>{{listingName}}</strong>" je odobren!</p>
<p>Sada možete da ga postavite na mrežu i počnete da primate zahteve za rezervacije.</p>
<p>Srećno sa rezervacijama!</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'listingName'],
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

If you need assistance, contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your listing "<strong>{{listingName}}</strong>" could not be approved at this time.</p>
<p><strong>Reason:</strong><br>{{reason}}</p>
<p>Please review the feedback, make the necessary changes to your listing, and resubmit it for review.</p>
<p>If you need assistance, contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
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

Ako vam je potrebna pomoć, kontaktirajte naš tim za podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaš oglas "<strong>{{listingName}}</strong>" trenutno ne može biti odobren.</p>
<p><strong>Razlog:</strong><br>{{reason}}</p>
<p>Molimo pregledajte povratne informacije, napravite potrebne izmene u svom oglasu i ponovo ga pošaljite na pregled.</p>
<p>Ako vam je potrebna pomoć, kontaktirajte naš tim za podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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

The listing is no longer visible to guests and cannot receive bookings. To resolve this issue, please contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your listing "<strong>{{listingName}}</strong>" has been suspended and taken offline.</p>
<p><strong>Reason:</strong><br>{{reason}}</p>
<p>The listing is no longer visible to guests and cannot receive bookings. To resolve this issue, please contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
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

Oglas više nije vidljiv gostima i ne može primati rezervacije. Da biste rešili ovaj problem, molimo kontaktirajte naš tim za podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaš oglas "<strong>{{listingName}}</strong>" je suspendovan i uklonjen sa mreže.</p>
<p><strong>Razlog:</strong><br>{{reason}}</p>
<p>Oglas više nije vidljiv gostima i ne može primati rezervacije. Da biste rešili ovaj problem, molimo kontaktirajte naš tim za podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: 'Your Live ID Verification Has Been Approved ✓',
    bodyText: `Hi {{name}},

Your Live ID verification has been successfully approved!

Your host account verification is now complete. Thank you for helping us maintain a safe and trusted community.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your Live ID verification has been successfully approved!</p>
<p>Your host account verification is now complete. Thank you for helping us maintain a safe and trusted community.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#REQUEST_APPROVED',
    sk: 'LANG#sr',
    templateName: 'REQUEST_APPROVED',
    language: 'sr',
    subject: 'Vaša Live ID verifikacija je odobrena ✓',
    bodyText: `Zdravo {{name}},

Vaša Live ID verifikacija je uspešno odobrena!

Verifikacija vašeg naloga domaćina je sada završena. Hvala što nam pomažete da održimo bezbednu zajednicu od poverenja.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaša Live ID verifikacija je uspešno odobrena!</p>
<p>Verifikacija vašeg naloga domaćina je sada završena. Hvala što nam pomažete da održimo bezbednu zajednicu od poverenja.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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

If you have questions about the requirements, contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>We were unable to approve your Live ID verification submission.</p>
<p><strong>Reason:</strong><br>{{reason}}</p>
<p>Please submit a new Live ID video from your LocalStays host account that addresses the feedback provided.</p>
<p>If you have questions about the requirements, contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
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

Ako imate pitanja o zahtevima, kontaktirajte naš tim za podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Nismo mogli da odobrimo vašu Live ID verifikaciju.</p>
<p><strong>Razlog:</strong><br>{{reason}}</p>
<p>Molimo pošaljite novi Live ID video iz vašeg LocalStays naloga domaćina koji uzima u obzir date povratne informacije.</p>
<p>Ako imate pitanja o zahtevima, kontaktirajte naš tim za podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'reason'],
    createdAt: now,
    updatedAt: now,
  },
];















