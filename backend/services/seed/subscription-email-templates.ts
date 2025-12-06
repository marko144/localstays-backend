/**
 * Subscription & Slot Email Templates Seed Data
 * 
 * Email templates for subscription lifecycle and advertising slot events:
 * - Ads expiring soon (7 days warning)
 * - Ads expired (slot deleted, listing unpublished)
 * - Payment failed (grace period started)
 * - Subscription cancelled
 * 
 * All templates in English (en) and Serbian (sr)
 */

import type { EmailTemplateSeed } from './admin-email-templates';

const now = new Date().toISOString();

export const subscriptionEmailTemplates: EmailTemplateSeed[] = [
  // ========================================
  // ADS_EXPIRING_SOON - Warning 7 days before
  // ========================================
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRING_SOON',
    sk: 'LANG#en',
    templateName: 'ADS_EXPIRING_SOON',
    language: 'en',
    subject: '⏰ Your ads are expiring soon - LocalStays',
    bodyText: `Hi {{name}},

Your advertising slots are expiring soon. Here are the ads that will expire in 7 days:

{{listingsList}}

To keep your ads online, make sure your subscription is active. If your subscription is set to auto-renew, your ads will be automatically extended.

If you've cancelled your subscription, these ads will go offline when they expire.

Manage your subscription: {{subscriptionUrl}}

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your advertising slots are expiring soon. Here are the ads that will expire in 7 days:</p>
<div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
{{listingsListHtml}}
</div>
<p>To keep your ads online, make sure your subscription is active. If your subscription is set to auto-renew, your ads will be automatically extended.</p>
<p>If you've cancelled your subscription, these ads will go offline when they expire.</p>
<p><a href="{{subscriptionUrl}}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Manage Subscription</a></p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'subscriptionUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRING_SOON',
    sk: 'LANG#sr',
    templateName: 'ADS_EXPIRING_SOON',
    language: 'sr',
    subject: '⏰ Vaši oglasi uskoro ističu - LocalStays',
    bodyText: `Zdravo {{name}},

Vaši oglasni slotovi uskoro ističu. Evo oglasa koji ističu za 7 dana:

{{listingsList}}

Da biste zadržali oglase online, proverite da li je vaša pretplata aktivna. Ako je vaša pretplata podešena na automatsko obnavljanje, oglasi će se automatski produžiti.

Ako ste otkazali pretplatu, ovi oglasi će biti isključeni kada isteknu.

Upravljajte pretplatom: {{subscriptionUrl}}

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaši oglasni slotovi uskoro ističu. Evo oglasa koji ističu za 7 dana:</p>
<div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
{{listingsListHtml}}
</div>
<p>Da biste zadržali oglase online, proverite da li je vaša pretplata aktivna. Ako je vaša pretplata podešena na automatsko obnavljanje, oglasi će se automatski produžiti.</p>
<p>Ako ste otkazali pretplatu, ovi oglasi će biti isključeni kada isteknu.</p>
<p><a href="{{subscriptionUrl}}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Upravljaj pretplatom</a></p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'subscriptionUrl'],
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
    subject: '📴 Your ads have expired - LocalStays',
    bodyText: `Hi {{name}},

The following ads have expired and are now offline:

{{listingsList}}

Your listings are still saved and can be published again once you have an active subscription with available tokens.

To get your ads back online:
1. Make sure you have an active subscription
2. Go to your listings and publish them again

Manage your subscription: {{subscriptionUrl}}

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>The following ads have expired and are now offline:</p>
<div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin: 15px 0;">
{{listingsListHtml}}
</div>
<p>Your listings are still saved and can be published again once you have an active subscription with available tokens.</p>
<p><strong>To get your ads back online:</strong></p>
<ol>
<li>Make sure you have an active subscription</li>
<li>Go to your listings and publish them again</li>
</ol>
<p><a href="{{subscriptionUrl}}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Manage Subscription</a></p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'subscriptionUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#ADS_EXPIRED',
    sk: 'LANG#sr',
    templateName: 'ADS_EXPIRED',
    language: 'sr',
    subject: '📴 Vaši oglasi su istekli - LocalStays',
    bodyText: `Zdravo {{name}},

Sledeći oglasi su istekli i sada su offline:

{{listingsList}}

Vaši oglasi su i dalje sačuvani i mogu se ponovo objaviti kada budete imali aktivnu pretplatu sa dostupnim tokenima.

Da vratite oglase online:
1. Proverite da imate aktivnu pretplatu
2. Idite na svoje oglase i ponovo ih objavite

Upravljajte pretplatom: {{subscriptionUrl}}

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Sledeći oglasi su istekli i sada su offline:</p>
<div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin: 15px 0;">
{{listingsListHtml}}
</div>
<p>Vaši oglasi su i dalje sačuvani i mogu se ponovo objaviti kada budete imali aktivnu pretplatu sa dostupnim tokenima.</p>
<p><strong>Da vratite oglase online:</strong></p>
<ol>
<li>Proverite da imate aktivnu pretplatu</li>
<li>Idite na svoje oglase i ponovo ih objavite</li>
</ol>
<p><a href="{{subscriptionUrl}}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Upravljaj pretplatom</a></p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'listingsList', 'listingsListHtml', 'subscriptionUrl'],
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
    subject: '⚠️ Payment failed - Action required - LocalStays',
    bodyText: `Hi {{name}},

We were unable to process your subscription payment.

Your ads will remain online during a short grace period, but you won't be able to publish new ads until the payment issue is resolved.

Please update your payment method to avoid any interruption to your service.

Update payment method: {{customerPortalUrl}}

If you have any questions, please contact our support team.

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>We were unable to process your subscription payment.</p>
<div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #f59e0b;">
<p style="margin: 0;"><strong>⚠️ Action Required</strong></p>
<p style="margin: 10px 0 0 0;">Your ads will remain online during a short grace period, but you won't be able to publish new ads until the payment issue is resolved.</p>
</div>
<p>Please update your payment method to avoid any interruption to your service.</p>
<p><a href="{{customerPortalUrl}}" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Update Payment Method</a></p>
<p>If you have any questions, please contact our support team.</p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'customerPortalUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#PAYMENT_FAILED',
    sk: 'LANG#sr',
    templateName: 'PAYMENT_FAILED',
    language: 'sr',
    subject: '⚠️ Plaćanje nije uspelo - Potrebna akcija - LocalStays',
    bodyText: `Zdravo {{name}},

Nismo uspeli da obradimo vašu uplatu za pretplatu.

Vaši oglasi će ostati online tokom kratkog perioda čekanja, ali nećete moći da objavljujete nove oglase dok se problem sa plaćanjem ne reši.

Molimo vas da ažurirate način plaćanja kako biste izbegli prekid usluge.

Ažurirajte način plaćanja: {{customerPortalUrl}}

Ako imate pitanja, kontaktirajte naš tim za podršku.

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Nismo uspeli da obradimo vašu uplatu za pretplatu.</p>
<div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #f59e0b;">
<p style="margin: 0;"><strong>⚠️ Potrebna akcija</strong></p>
<p style="margin: 10px 0 0 0;">Vaši oglasi će ostati online tokom kratkog perioda čekanja, ali nećete moći da objavljujete nove oglase dok se problem sa plaćanjem ne reši.</p>
</div>
<p>Molimo vas da ažurirate način plaćanja kako biste izbegli prekid usluge.</p>
<p><a href="{{customerPortalUrl}}" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Ažuriraj način plaćanja</a></p>
<p>Ako imate pitanja, kontaktirajte naš tim za podršku.</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'customerPortalUrl'],
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
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Your LocalStays subscription has been cancelled as requested.</p>
<div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
<p style="margin: 0;">Your current ads will remain online until <strong>{{periodEndDate}}</strong>, after which they will be taken offline.</p>
</div>
<p>If you change your mind, you can resubscribe at any time from your dashboard.</p>
<p>We hope to see you again soon!</p>
<p>Best regards,<br>The LocalStays Team</p>`,
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
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Vaša LocalStays pretplata je otkazana po vašem zahtevu.</p>
<div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
<p style="margin: 0;">Vaši trenutni oglasi će ostati online do <strong>{{periodEndDate}}</strong>, nakon čega će biti isključeni.</p>
</div>
<p>Ako se predomislite, možete se ponovo pretplatiti u bilo kom trenutku sa vašeg dashboard-a.</p>
<p>Nadamo se da ćemo vas ponovo videti uskoro!</p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
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
    subject: '🎉 Welcome to LocalStays {{planName}}!',
    bodyText: `Hi {{name}},

Thank you for subscribing to LocalStays {{planName}}!

Your subscription details:
- Plan: {{planName}}
- Tokens: {{tokenCount}} ads
- Billing period: {{billingPeriod}}
- Next billing date: {{nextBillingDate}}

You can now publish up to {{tokenCount}} ads at the same time. Go to your listings to get started!

Manage your subscription: {{subscriptionUrl}}

Best regards,
The LocalStays Team`,
    bodyHtml: `<p>Hi {{name}},</p>
<p>Thank you for subscribing to LocalStays <strong>{{planName}}</strong>!</p>
<div style="background: #ecfdf5; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #10b981;">
<p style="margin: 0 0 10px 0;"><strong>Your subscription details:</strong></p>
<ul style="margin: 0; padding-left: 20px;">
<li>Plan: {{planName}}</li>
<li>Tokens: {{tokenCount}} ads</li>
<li>Billing period: {{billingPeriod}}</li>
<li>Next billing date: {{nextBillingDate}}</li>
</ul>
</div>
<p>You can now publish up to <strong>{{tokenCount}}</strong> ads at the same time. Go to your listings to get started!</p>
<p><a href="{{subscriptionUrl}}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Manage Subscription</a></p>
<p>Best regards,<br>The LocalStays Team</p>`,
    variables: ['name', 'planName', 'tokenCount', 'billingPeriod', 'nextBillingDate', 'subscriptionUrl'],
    createdAt: now,
    updatedAt: now,
  },
  {
    pk: 'EMAIL_TEMPLATE#SUBSCRIPTION_WELCOME',
    sk: 'LANG#sr',
    templateName: 'SUBSCRIPTION_WELCOME',
    language: 'sr',
    subject: '🎉 Dobrodošli u LocalStays {{planName}}!',
    bodyText: `Zdravo {{name}},

Hvala vam što ste se pretplatili na LocalStays {{planName}}!

Detalji vaše pretplate:
- Plan: {{planName}}
- Tokeni: {{tokenCount}} oglasa
- Period naplate: {{billingPeriod}}
- Sledeći datum naplate: {{nextBillingDate}}

Sada možete objaviti do {{tokenCount}} oglasa istovremeno. Idite na svoje oglase da započnete!

Upravljajte pretplatom: {{subscriptionUrl}}

Srdačan pozdrav,
LocalStays Tim`,
    bodyHtml: `<p>Zdravo {{name}},</p>
<p>Hvala vam što ste se pretplatili na LocalStays <strong>{{planName}}</strong>!</p>
<div style="background: #ecfdf5; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #10b981;">
<p style="margin: 0 0 10px 0;"><strong>Detalji vaše pretplate:</strong></p>
<ul style="margin: 0; padding-left: 20px;">
<li>Plan: {{planName}}</li>
<li>Tokeni: {{tokenCount}} oglasa</li>
<li>Period naplate: {{billingPeriod}}</li>
<li>Sledeći datum naplate: {{nextBillingDate}}</li>
</ul>
</div>
<p>Sada možete objaviti do <strong>{{tokenCount}}</strong> oglasa istovremeno. Idite na svoje oglase da započnete!</p>
<p><a href="{{subscriptionUrl}}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Upravljaj pretplatom</a></p>
<p>Srdačan pozdrav,<br>LocalStays Tim</p>`,
    variables: ['name', 'planName', 'tokenCount', 'billingPeriod', 'nextBillingDate', 'subscriptionUrl'],
    createdAt: now,
    updatedAt: now,
  },
];

