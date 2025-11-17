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
    body: 'Vaš oglas "{{listingName}}" je odbijen. Razlog: {{reason}}',
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
    body: 'Your listing "{{listingName}}" has been rejected. Reason: {{reason}}',
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
    body: 'Vaš host profil je odbijen. Razlog: {{reason}}',
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
    body: 'Your host profile has been rejected. Reason: {{reason}}',
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
  // REQUEST_UPDATE_NEEDED - Serbian
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#REQUEST_UPDATE_NEEDED',
    sk: 'LANG#sr',
    templateName: 'REQUEST_UPDATE_NEEDED',
    language: 'sr',
    title: '📝 Potrebne izmene',
    body: 'Admin traži izmene za vaš {{requestType}} zahtev. Razlog: {{reason}}',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/requests',
    requireInteraction: true,
    silent: false,
    tag: 'request-update-needed',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin requests changes to a host request',
  },

  // ============================================================================
  // REQUEST_UPDATE_NEEDED - English
  // ============================================================================
  {
    pk: 'NOTIFICATION_TEMPLATE#REQUEST_UPDATE_NEEDED',
    sk: 'LANG#en',
    templateName: 'REQUEST_UPDATE_NEEDED',
    language: 'en',
    title: '📝 Updates Needed',
    body: 'Admin requested changes to your {{requestType}} request. Reason: {{reason}}',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    actionUrlPath: '/requests',
    requireInteraction: true,
    silent: false,
    tag: 'request-update-needed',
    createdAt: now,
    updatedAt: now,
    notes: 'Notification sent when admin requests changes to a host request',
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
];

