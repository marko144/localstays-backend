/**
 * Profile Data Validation
 * Validates host profile submissions (polymorphic validation)
 */

import {
  ProfileData,
  IndividualProfileData,
  BusinessProfileData,
  isIndividualProfile,
  isBusinessProfile,
  Address,
} from '../../types/host.types';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ProfileValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number (E.164 format)
 */
function isValidPhone(phone: string): boolean {
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
}

/**
 * Validate ISO-3166-1 alpha-2 country code
 */
function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
}

/**
 * Validate BCP-47 language code
 */
function isValidLanguageCode(code: string): boolean {
  // Simple validation: language[-country]
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(code);
}

/**
 * Validate address
 */
function validateAddress(address: Address, errors: ValidationError[]): void {
  if (!address.addressLine1 || address.addressLine1.trim().length === 0) {
    errors.push({ field: 'address.addressLine1', message: 'Address line 1 is required' });
  } else if (address.addressLine1.length > 200) {
    errors.push({ field: 'address.addressLine1', message: 'Address line 1 must be 200 characters or less' });
  }
  
  if (address.addressLine2 && address.addressLine2.length > 200) {
    errors.push({ field: 'address.addressLine2', message: 'Address line 2 must be 200 characters or less' });
  }
  
  if (!address.locality || address.locality.trim().length === 0) {
    errors.push({ field: 'address.locality', message: 'City is required' });
  } else if (address.locality.length > 100) {
    errors.push({ field: 'address.locality', message: 'City must be 100 characters or less' });
  }
  
  if (!address.administrativeArea || address.administrativeArea.trim().length === 0) {
    errors.push({ field: 'address.administrativeArea', message: 'State/Province is required' });
  } else if (address.administrativeArea.length > 100) {
    errors.push({ field: 'address.administrativeArea', message: 'State/Province must be 100 characters or less' });
  }
  
  if (!address.postalCode || address.postalCode.trim().length === 0) {
    errors.push({ field: 'address.postalCode', message: 'Postal code is required' });
  } else if (address.postalCode.length > 20) {
    errors.push({ field: 'address.postalCode', message: 'Postal code must be 20 characters or less' });
  }
  
  if (!address.countryCode || !isValidCountryCode(address.countryCode)) {
    errors.push({ field: 'address.countryCode', message: 'Valid ISO country code is required (e.g., "RS", "GB")' });
  }
}

/**
 * Validate common profile fields
 */
function validateCommonFields(profile: ProfileData, errors: ValidationError[]): void {
  // Email
  if (!profile.email || !isValidEmail(profile.email)) {
    errors.push({ field: 'email', message: 'Valid email address is required' });
  }
  
  // Phone
  if (!profile.phone || !isValidPhone(profile.phone)) {
    errors.push({ field: 'phone', message: 'Valid phone number is required (E.164 format, e.g., +381601234567)' });
  }
  
  // Country code
  if (!profile.countryCode || !isValidCountryCode(profile.countryCode)) {
    errors.push({ field: 'countryCode', message: 'Valid ISO country code is required (e.g., "RS")' });
  }
  
  // Preferred language
  if (!profile.preferredLanguage || !isValidLanguageCode(profile.preferredLanguage)) {
    errors.push({ field: 'preferredLanguage', message: 'Valid language code is required (e.g., "sr-RS", "en-GB")' });
  }
  
  // Address
  if (!profile.address) {
    errors.push({ field: 'address', message: 'Address is required' });
  } else {
    validateAddress(profile.address, errors);
  }
}

/**
 * Validate INDIVIDUAL profile specific fields
 */
function validateIndividualProfile(profile: IndividualProfileData, errors: ValidationError[]): void {
  if (!profile.forename || profile.forename.trim().length === 0) {
    errors.push({ field: 'forename', message: 'First name is required for individual hosts' });
  } else if (profile.forename.length > 100) {
    errors.push({ field: 'forename', message: 'First name must be 100 characters or less' });
  }
  
  if (!profile.surname || profile.surname.trim().length === 0) {
    errors.push({ field: 'surname', message: 'Last name is required for individual hosts' });
  } else if (profile.surname.length > 100) {
    errors.push({ field: 'surname', message: 'Last name must be 100 characters or less' });
  }
  
  // Ensure business fields are not present
  const businessFields = ['legalName', 'registrationNumber', 'vatRegistered', 'vatNumber', 'displayName'];
  for (const field of businessFields) {
    if (field in profile && (profile as any)[field] !== undefined) {
      errors.push({
        field,
        message: `Field "${field}" should not be present for individual hosts`,
      });
    }
  }
}

/**
 * Validate BUSINESS profile specific fields
 */
function validateBusinessProfile(profile: BusinessProfileData, errors: ValidationError[]): void {
  if (!profile.legalName || profile.legalName.trim().length === 0) {
    errors.push({ field: 'legalName', message: 'Legal name is required for business hosts' });
  } else if (profile.legalName.length > 200) {
    errors.push({ field: 'legalName', message: 'Legal name must be 200 characters or less' });
  }
  
  if (!profile.registrationNumber || profile.registrationNumber.trim().length === 0) {
    errors.push({ field: 'registrationNumber', message: 'Registration number is required for business hosts' });
  } else if (profile.registrationNumber.length > 50) {
    errors.push({ field: 'registrationNumber', message: 'Registration number must be 50 characters or less' });
  }
  
  if (profile.vatRegistered === undefined || profile.vatRegistered === null) {
    errors.push({ field: 'vatRegistered', message: 'VAT registration status is required for business hosts' });
  }
  
  if (profile.vatRegistered) {
    if (!profile.vatNumber || profile.vatNumber.trim().length === 0) {
      errors.push({ field: 'vatNumber', message: 'VAT number is required when business is VAT registered' });
    } else if (profile.vatNumber.length > 50) {
      errors.push({ field: 'vatNumber', message: 'VAT number must be 50 characters or less' });
    }
  }
  
  if (profile.displayName && profile.displayName.length > 200) {
    errors.push({ field: 'displayName', message: 'Display name must be 200 characters or less' });
  }
  
  // Ensure individual fields are not present
  const individualFields = ['forename', 'surname'];
  for (const field of individualFields) {
    if (field in profile && (profile as any)[field] !== undefined) {
      errors.push({
        field,
        message: `Field "${field}" should not be present for business hosts`,
      });
    }
  }
}

/**
 * Validate complete profile data
 */
export function validateProfileData(profile: ProfileData): ProfileValidationResult {
  const errors: ValidationError[] = [];
  
  // Validate host type
  if (!profile.hostType || !['INDIVIDUAL', 'BUSINESS'].includes(profile.hostType)) {
    errors.push({ field: 'hostType', message: 'Host type must be either "INDIVIDUAL" or "BUSINESS"' });
    // Cannot continue validation without valid hostType
    return { valid: false, errors };
  }
  
  // Validate common fields
  validateCommonFields(profile, errors);
  
  // Polymorphic validation based on hostType
  if (isIndividualProfile(profile)) {
    validateIndividualProfile(profile, errors);
  } else if (isBusinessProfile(profile)) {
    validateBusinessProfile(profile, errors);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize string input (trim, remove extra whitespace)
 */
export function sanitizeString(input: string | undefined | null): string {
  if (!input) return '';
  return input.trim().replace(/\s+/g, ' ');
}

/**
 * Sanitize and normalize language code to BCP-47 format
 * Examples: "en-gb" -> "en-GB", "EN-US" -> "en-US", "sr" -> "sr"
 */
function normalizeLanguageCode(code: string): string {
  const sanitized = sanitizeString(code);
  if (!sanitized) return '';
  
  const parts = sanitized.split('-');
  if (parts.length === 1) {
    // Just language code: lowercase it
    return parts[0].toLowerCase();
  } else if (parts.length === 2) {
    // Language-Country: lowercase language, uppercase country
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  // Invalid format, return as-is (will fail validation)
  return sanitized;
}

/**
 * Sanitize profile data (trim strings, normalize values)
 */
export function sanitizeProfileData(profile: ProfileData): ProfileData {
  const sanitized: any = {
    ...profile,
    email: sanitizeString(profile.email).toLowerCase(),
    phone: sanitizeString(profile.phone),
    preferredLanguage: normalizeLanguageCode(profile.preferredLanguage),
    countryCode: sanitizeString(profile.countryCode).toUpperCase(),
    address: {
      addressLine1: sanitizeString(profile.address.addressLine1),
      addressLine2: profile.address.addressLine2 ? sanitizeString(profile.address.addressLine2) : null,
      locality: sanitizeString(profile.address.locality),
      administrativeArea: sanitizeString(profile.address.administrativeArea),
      postalCode: sanitizeString(profile.address.postalCode),
      countryCode: sanitizeString(profile.address.countryCode).toUpperCase(),
    },
  };
  
  if (isIndividualProfile(profile)) {
    sanitized.forename = sanitizeString(profile.forename);
    sanitized.surname = sanitizeString(profile.surname);
  } else if (isBusinessProfile(profile)) {
    sanitized.legalName = sanitizeString(profile.legalName);
    sanitized.registrationNumber = sanitizeString(profile.registrationNumber);
    sanitized.vatNumber = profile.vatNumber ? sanitizeString(profile.vatNumber) : null;
    sanitized.displayName = profile.displayName ? sanitizeString(profile.displayName) : null;
  }
  
  return sanitized as ProfileData;
}

