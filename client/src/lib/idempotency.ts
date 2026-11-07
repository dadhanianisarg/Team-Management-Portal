/**
 * Frontend Idempotency Utility for Coordina
 * Manages scoped idempotency keys in sessionStorage to guarantee at-most-once resource creation.
 */

export interface IdempotencyStorageEntry {
  key: string;
  payload: any;
  createdAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Produces a stable, deterministic JSON string with sorted keys for object comparison.
 */
export function canonicalizePayload(obj: any): string {
  if (obj === null || obj === undefined) {
    return "";
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalizePayload(item)).join(",")}]`;
  }
  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalizePayload(obj[key])}`
  );
  return `{${parts.join(",")}}`;
}

/**
 * Generates a standard RFC4122 v4 UUID using crypto.randomUUID or fallback.
 */
export function generateUUID(): string {
  if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  // Standard compliant fallback if crypto.randomUUID is unavailable
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Builds a scoped storage key for task creation.
 */
export function getTaskIdempotencyScope(
  workspaceId: string,
  projectId?: string
): string {
  return `coordina:idempotency:create-task:${workspaceId}:${projectId || "default"}`;
}

/**
 * Builds a scoped storage key for project creation.
 */
export function getProjectIdempotencyScope(workspaceId: string): string {
  return `coordina:idempotency:create-project:${workspaceId}`;
}

/**
 * Retrieves the pending attempt from sessionStorage if valid and not expired.
 */
export function getPendingAttempt(scopeKey: string): IdempotencyStorageEntry | null {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(scopeKey);
    if (!raw) return null;
    const parsed: IdempotencyStorageEntry = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.key !== "string" ||
      typeof parsed.createdAt !== "number" ||
      parsed.payload === undefined
    ) {
      window.sessionStorage.removeItem(scopeKey);
      return null;
    }
    // Check expiration
    if (Date.now() - parsed.createdAt > DEFAULT_TTL_MS) {
      window.sessionStorage.removeItem(scopeKey);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(scopeKey);
    } catch {
      // Ignore storage errors
    }
    return null;
  }
}

/**
 * Gets the existing UUID if the payload matches the pending attempt,
 * or generates and persists a new UUID if starting a new attempt or if the payload changed.
 */
export function getOrCreateIdempotencyKey(
  scopeKey: string,
  currentPayload: any
): string {
  const pending = getPendingAttempt(scopeKey);

  if (pending) {
    const pendingHash = canonicalizePayload(pending.payload);
    const currentHash = canonicalizePayload(currentPayload);

    // If identical payload, reuse existing idempotency key (retry / double-click protection)
    if (pendingHash === currentHash) {
      return pending.key;
    }
  }

  // Generate new UUID for new or modified payload
  const newKey = generateUUID();
  const entry: IdempotencyStorageEntry = {
    key: newKey,
    payload: currentPayload,
    createdAt: Date.now(),
  };

  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(scopeKey, JSON.stringify(entry));
    } catch (e) {
      console.warn("Unable to save idempotency key to sessionStorage:", e);
    }
  }

  return newKey;
}

/**
 * Clears the pending idempotency entry upon confirmed creation success.
 */
export function clearIdempotencyKey(scopeKey: string): void {
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(scopeKey);
    } catch {
      // Ignore storage errors
    }
  }
}
