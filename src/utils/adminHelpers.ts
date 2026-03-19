/**
 * Shared helpers for admin controllers.
 * Extracted from adminUserDetailController.ts to be reused
 * across all admin controller modules.
 */

import { Response } from "express";

const MAX_ID_LENGTH = 255;

export function parsePagination(
  query: { page?: string; limit?: string },
  defaultLimit = 20,
): { page: number; limit: number; skip: number } {
  const parsedPage = query.page ? parseInt(query.page, 10) : 1;
  const parsedLimit = query.limit ? parseInt(query.limit, 10) : defaultLimit;
  const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? defaultLimit : parsedLimit, 100);
  return { page, limit, skip: (page - 1) * limit };
}

export function validateUserId(userId: string | undefined, res: Response): userId is string {
  if (!userId || userId.length > MAX_ID_LENGTH) {
    res.status(400).json({ success: false, error: "userId requis" });
    return false;
  }
  return true;
}

export function validateParam(
  value: string | undefined,
  name: string,
  res: Response,
): value is string {
  if (!value || value.length > MAX_ID_LENGTH) {
    res.status(400).json({ success: false, error: `${name} requis` });
    return false;
  }
  return true;
}
