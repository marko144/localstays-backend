/**
 * Document Validation Utilities
 * Validates document types, formats, and requirements
 */

import {
  DocumentUploadIntent,
  DocumentValidationResult,
  DOCUMENT_REQUIREMENTS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
} from '../../types/document.types';
import { HostType } from '../../types/host.types';

/**
 * Validate document types meet requirements for host type
 */
export function validateDocumentTypes(
  hostType: HostType,
  documents: DocumentUploadIntent[],
  vatRegistered: boolean = false
): DocumentValidationResult {
  const requirements = DOCUMENT_REQUIREMENTS[hostType];
  const providedTypes = documents.map(d => d.documentType);
  
  const missing: string[] = [];
  const errors: string[] = [];
  
  // Check 'anyOf' requirements (at least one from each group)
  if (requirements.required.anyOf) {
    for (const group of requirements.required.anyOf) {
      const hasAny = group.some(type => providedTypes.includes(type));
      if (!hasAny) {
        missing.push(`One of: ${group.join(' or ')}`);
      }
    }
  }
  
  // Check 'all' requirements
  if (requirements.required.all) {
    for (const type of requirements.required.all) {
      if (!providedTypes.includes(type)) {
        missing.push(type);
      }
    }
  }
  
  // Check conditional requirements
  if (requirements.conditional) {
    for (const conditional of requirements.conditional) {
      if (conditional.condition === 'vatRegistered' && vatRegistered) {
        for (const docType of conditional.documents) {
          if (!providedTypes.includes(docType)) {
            missing.push(`${docType} (required when VAT registered)`);
          }
        }
      }
    }
  }
  
  // Check for duplicate document types
  const typeCounts = providedTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > 1) {
      errors.push(`Duplicate document type: ${type}`);
    }
  }
  
  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  };
}

/**
 * Validate individual document upload intent
 */
export function validateDocumentIntent(document: DocumentUploadIntent): string[] {
  const errors: string[] = [];
  
  // Validate file size
  if (document.fileSize <= 0) {
    errors.push(`Invalid file size for ${document.fileName}`);
  }
  
  if (document.fileSize > MAX_FILE_SIZE) {
    errors.push(
      `File ${document.fileName} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
    );
  }
  
  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(document.mimeType as any)) {
    errors.push(
      `File ${document.fileName} has unsupported type: ${document.mimeType}. ` +
      `Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }
  
  // Validate filename
  if (!document.fileName || document.fileName.length === 0) {
    errors.push('Filename cannot be empty');
  }
  
  if (document.fileName.length > 255) {
    errors.push(`Filename ${document.fileName} exceeds maximum length of 255 characters`);
  }
  
  // Check for potentially dangerous characters
  const dangerousChars = /[<>:"|?*\x00-\x1F]/;
  if (dangerousChars.test(document.fileName)) {
    errors.push(`Filename ${document.fileName} contains invalid characters`);
  }
  
  return errors;
}

/**
 * Validate all document intents
 */
export function validateAllDocumentIntents(documents: DocumentUploadIntent[]): {
  valid: boolean;
  errors: string[];
} {
  const allErrors: string[] = [];
  
  // Validate each document
  for (const doc of documents) {
    const docErrors = validateDocumentIntent(doc);
    allErrors.push(...docErrors);
  }
  
  // Validate total size
  const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    allErrors.push(
      `Total file size (${(totalSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${MAX_TOTAL_SIZE / 1024 / 1024}MB`
    );
  }
  
  // Check minimum documents
  if (documents.length === 0) {
    allErrors.push('At least one document is required');
  }
  
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Sanitize filename (remove dangerous characters, limit length)
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  const basename = filename.split('/').pop() || filename;
  
  // Replace dangerous characters with underscore
  let sanitized = basename.replace(/[<>:"|?*\x00-\x1F]/g, '_');
  
  // Remove leading/trailing spaces and dots
  sanitized = sanitized.trim().replace(/^\.+/, '').replace(/\.+$/, '');
  
  // Limit length while preserving extension
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop() || '';
    const nameWithoutExt = sanitized.substring(0, sanitized.length - ext.length - 1);
    sanitized = nameWithoutExt.substring(0, 255 - ext.length - 1) + '.' + ext;
  }
  
  return sanitized || 'document';
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

/**
 * Verify MIME type matches file extension (basic check)
 */
export function verifyMimeType(filename: string, mimeType: string): boolean {
  const ext = getFileExtension(filename);
  const mimeTypeMap: Record<string, string[]> = {
    pdf: ['application/pdf'],
    jpg: ['image/jpeg', 'image/jpg'],
    jpeg: ['image/jpeg', 'image/jpg'],
    png: ['image/png'],
  };
  
  const expectedMimeTypes = mimeTypeMap[ext];
  if (!expectedMimeTypes) {
    return false;
  }
  
  return expectedMimeTypes.includes(mimeType);
}

