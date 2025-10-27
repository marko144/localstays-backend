/**
 * Pagination Utilities
 * 
 * Helpers for implementing consistent pagination across admin endpoints.
 */

import { PaginationMeta } from '../../types/admin.types';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 20;

/**
 * Parse and validate pagination parameters from query string
 */
export function parsePaginationParams(queryParams: { [key: string]: string | undefined }): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(queryParams.page || '1', 10));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(queryParams.limit || String(DEFAULT_PAGE_SIZE), 10)));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Build pagination metadata for response
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);

  return {
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Paginate an in-memory array (for Scan results)
 */
export function paginateArray<T>(
  items: T[],
  page: number,
  limit: number
): {
  items: T[];
  pagination: PaginationMeta;
} {
  const offset = (page - 1) * limit;
  const paginatedItems = items.slice(offset, offset + limit);

  return {
    items: paginatedItems,
    pagination: buildPaginationMeta(items.length, page, limit),
  };
}

