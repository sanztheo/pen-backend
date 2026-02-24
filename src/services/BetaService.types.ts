import { Prisma } from "@prisma/client";
import type { BetaStatus } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────
export const TOTAL_BETA_SPOTS = 100;
export const HEARTBEAT_INCREMENT_SECONDS = 30;
export const HEARTBEAT_MIN_INTERVAL_SECONDS = 25;
export const STATUS_CACHE_KEY = "beta:active_count";
export const STATUS_CACHE_TTL_SECONDS = 30;
export const SERIALIZATION_MAX_RETRIES = 3;
export const SERIALIZATION_BASE_DELAY_MS = 50;

// ─── Interfaces ───────────────────────────────────────────
export interface BetaStatusResponse {
  spotsRemaining: number;
  totalSpots: number;
  isFull: boolean;
  userStatus: BetaStatus | undefined;
}

export interface WaitlistInput {
  email: string;
  name: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface WaitlistResult {
  position: number;
  alreadyExists: boolean;
  rejected?: boolean;
  isOwned?: boolean;
}

// ─── Type Guards ──────────────────────────────────────────
/** Validates that a value is safe for Prisma JSON storage */
export function isInputJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (value === undefined) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isInputJsonValue);
  if (typeof value === "object") return Object.values(value).every(isInputJsonValue);
  return false;
}
