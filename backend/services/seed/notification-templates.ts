/**
 * Notification Templates Seed Data
 * 
 * Initial notification templates for push notifications
 * Serbian (sr) and English (en) versions
 */

import type { NotificationTemplate } from '../types/notification.types';

const now = new Date().toISOString();

/**
 * Notification templates to seed into DynamoDB
 */
export const notificationTemplates: NotificationTemplate[] = [
  // ============================================================================
  // LISTING_APPROVED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#LISTING_APPROVED',
    sk: 'LANG#sr',
    templateName: 'LISTING_APPROVED',
    language: 'sr',
    title: '🎉 Oglas odobren!',
    body: 'Vaš oglas "{{listingName}}" je odobren i spreman je da bude online.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'listing-approved',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin approves a listing',
  },

  // ============================================================================
  // LISTING_APPROVED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#LISTING_APPROVED',
    sk: 'LANG#en',
    templateName: 'LISTING_APPROVED',
    language: 'en',
    title: '🎉 Listing Approved!',
    body: 'Your listing "{{listingName}}" has been approved and is ready to go online.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'listing-approved',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin approves a listing',
  },

  // ============================================================================
  // LISTING_REJECTED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#LISTING_REJECTED',
    sk: 'LANG#sr',
    templateName: 'LISTING_REJECTED',
    language: 'sr',
    title: '❌ Oglas odbijen',
    body: 'Vaš oglas "{{listingName}}" je odbijen. Pogledajte detalje u aplikaciji.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'listing-rejected',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin rejects a listing',
  },

  // ============================================================================
  // LISTING_REJECTED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#LISTING_REJECTED',
    sk: 'LANG#en',
    templateName: 'LISTING_REJECTED',
    language: 'en',
    title: '❌ Listing Rejected',
    body: 'Your listing "{{listingName}}" has been rejected. Check the app for details.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'listing-rejected',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin rejects a listing',
  },

  // ============================================================================
  // HOST_APPROVED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#HOST_APPROVED',
    sk: 'LANG#sr',
    templateName: 'HOST_APPROVED',
    language: 'sr',
    title: '✅ Profil odobren!',
    body: 'Vaš host profil je odobren! Sada možete kreirati oglase.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/dashboard',
    requireInteraction: true,
    silent: false,
    tag: 'host-approved',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin approves a host profile (KYC)',
  },

  // ============================================================================
  // HOST_APPROVED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#HOST_APPROVED',
    sk: 'LANG#en',
    templateName: 'HOST_APPROVED',
    language: 'en',
    title: '✅ Profile Approved!',
    body: 'Your host profile has been approved! You can now create listings.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/dashboard',
    requireInteraction: true,
    silent: false,
    tag: 'host-approved',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin approves a host profile (KYC)',
  },

  // ============================================================================
  // HOST_REJECTED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#HOST_REJECTED',
    sk: 'LANG#sr',
    templateName: 'HOST_REJECTED',
    language: 'sr',
    title: '❌ Profil odbijen',
    body: 'Vaš host profil je odbijen. Pogledajte detalje u aplikaciji.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/profile',
    requireInteraction: true,
    silent: false,
    tag: 'host-rejected',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin rejects a host profile (KYC)',
  },

  // ============================================================================
  // HOST_REJECTED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#HOST_REJECTED',
    sk: 'LANG#en',
    templateName: 'HOST_REJECTED',
    language: 'en',
    title: '❌ Profile Rejected',
    body: 'Your host profile has been rejected. Check the app for details.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/profile',
    requireInteraction: true,
    silent: false,
    tag: 'host-rejected',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin rejects a host profile (KYC)',
  },

  // ============================================================================
  // VIDEO_VERIFICATION_REQUESTED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#VIDEO_VERIFICATION_REQUESTED',
    sk: 'LANG#sr',
    templateName: 'VIDEO_VERIFICATION_REQUESTED',
    language: 'sr',
    title: '📹 Video verifikacija potrebna',
    body: 'Molimo snimite video verifikaciju za svoj oglas "{{listingName}}".',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'video-verification-requested',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin creates a video verification request for a listing',
  },

  // ============================================================================
  // VIDEO_VERIFICATION_REQUESTED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#VIDEO_VERIFICATION_REQUESTED',
    sk: 'LANG#en',
    templateName: 'VIDEO_VERIFICATION_REQUESTED',
    language: 'en',
    title: '📹 Video Verification Needed',
    body: 'Please record a video verification for your listing "{{listingName}}".',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'video-verification-requested',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin creates a video verification request for a listing',
  },

  // ============================================================================
  // LISTING_PUBLISHED - Serbian (auto-published after approval)
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#LISTING_PUBLISHED',
    sk: 'LANG#sr',
    templateName: 'LISTING_PUBLISHED',
    language: 'sr',
    title: '🚀 Oglas je online!',
    body: 'Vaš oglas "{{listingName}}" je sada online i vidljiv gostima.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'listing-published',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when listing is auto-published after admin approval',
  },

  // ============================================================================
  // LISTING_PUBLISHED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#LISTING_PUBLISHED',
    sk: 'LANG#en',
    templateName: 'LISTING_PUBLISHED',
    language: 'en',
    title: '🚀 Listing is Live!',
    body: 'Your listing "{{listingName}}" is now online and visible to guests.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/listings/{{listingId}}',
    requireInteraction: true,
    silent: false,
    tag: 'listing-published',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when listing is auto-published after admin approval',
  },

  // ============================================================================
  // ADS_EXPIRING_SOON - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#ADS_EXPIRING_SOON',
    sk: 'LANG#sr',
    templateName: 'ADS_EXPIRING_SOON',
    language: 'sr',
    title: '⏰ Oglasi uskoro ističu',
    body: 'Imate {{count}} oglas(a) koji ističu za 7 dana. Proverite svoju pretplatu.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/subscription',
    requireInteraction: true,
    silent: false,
    tag: 'ads-expiring-soon',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent 7 days before ad slots expire',
  },

  // ============================================================================
  // ADS_EXPIRING_SOON - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#ADS_EXPIRING_SOON',
    sk: 'LANG#en',
    templateName: 'ADS_EXPIRING_SOON',
    language: 'en',
    title: '⏰ Ads Expiring Soon',
    body: 'You have {{count}} ad(s) expiring in 7 days. Check your subscription.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/subscription',
    requireInteraction: true,
    silent: false,
    tag: 'ads-expiring-soon',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent 7 days before ad slots expire',
  },

  // ============================================================================
  // ADS_EXPIRED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#ADS_EXPIRED',
    sk: 'LANG#sr',
    templateName: 'ADS_EXPIRED',
    language: 'sr',
    title: '📴 Oglasi su istekli',
    body: '{{count}} oglas(a) je isteklo i sada su offline. Obnovite pretplatu da ih vratite.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/subscription',
    requireInteraction: true,
    silent: false,
    tag: 'ads-expired',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when ad slots expire and listings are unpublished',
  },

  // ============================================================================
  // ADS_EXPIRED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#ADS_EXPIRED',
    sk: 'LANG#en',
    templateName: 'ADS_EXPIRED',
    language: 'en',
    title: '📴 Ads Have Expired',
    body: '{{count}} ad(s) have expired and are now offline. Renew your subscription to restore them.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/subscription',
    requireInteraction: true,
    silent: false,
    tag: 'ads-expired',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when ad slots expire and listings are unpublished',
  },

  // ============================================================================
  // PAYMENT_FAILED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#PAYMENT_FAILED',
    sk: 'LANG#sr',
    templateName: 'PAYMENT_FAILED',
    language: 'sr',
    title: '⚠️ Plaćanje nije uspelo',
    body: 'Nismo uspeli da obradimo vašu uplatu. Ažurirajte način plaćanja da izbegnete prekid.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/subscription',
    requireInteraction: true,
    silent: false,
    tag: 'payment-failed',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when subscription payment fails',
  },

  // ============================================================================
  // PAYMENT_FAILED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#PAYMENT_FAILED',
    sk: 'LANG#en',
    templateName: 'PAYMENT_FAILED',
    language: 'en',
    title: '⚠️ Payment Failed',
    body: 'We couldn\'t process your payment. Update your payment method to avoid interruption.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/subscription',
    requireInteraction: true,
    silent: false,
    tag: 'payment-failed',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when subscription payment fails',
  },
];

