import { createHash, timingSafeEqual } from 'node:crypto';

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isValidChallenge(challenge: string): boolean {
  return CHALLENGE_PATTERN.test(challenge);
}

/** RFC 7636 S256: challenge = BASE64URL(SHA256(verifier)). */
export function verifyS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER_PATTERN.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
