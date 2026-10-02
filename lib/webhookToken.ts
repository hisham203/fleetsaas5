/**
 * lib/webhookToken.ts — Milestone H: Webhook token management.
 *
 * Token lifecycle:
 *  - generate(): create cryptographically random plaintext token
 *  - hashToken(): bcrypt-hash the plaintext for storage
 *  - verifyToken(): compare plaintext against stored hash
 *
 * The plaintext token is shown ONCE to the operator.
 * Only the bcrypt hash is stored in telematics_providers.webhook_token_hash.
 * Rotation invalidates the old token immediately (new hash replaces old).
 */

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

/** Generate a URL-safe plaintext token (48 hex chars = 192 bits entropy). */
export function generateWebhookToken(): string {
  return randomBytes(24).toString("hex"); // 48 hex characters
}

/** Hash a plaintext token for storage. */
export async function hashWebhookToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

/**
 * Verify a plaintext token against a stored bcrypt hash.
 * Returns true if it matches.
 */
export async function verifyWebhookToken(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
