import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const SALT_BYTES = 16; // per-record HKDF salt
const KEY_BYTES = 32; // AES-256
// HKDF "info" binds derived keys to this application/purpose (RFC 5869 §3.2).
const HKDF_INFO = Buffer.from('dave session credential encryption', 'utf8');

/**
 * Derive a 256-bit key with HKDF-SHA256 (RFC 5869). HKDF is purpose-built for
 * deriving keys from high-entropy input keying material — which SESSION_SECRET
 * is (a required 32+ char server secret, not a user password, so a slow
 * password hash like scrypt would buy nothing here). The random per-record salt
 * means every ciphertext is encrypted under its own distinct key.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), salt, HKDF_INFO, KEY_BYTES),
  );
}

export function encrypt(plaintext: string, secret: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = deriveKey(secret, salt);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [salt, iv, authTag, encrypted].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(ciphertext: string, secret: string): string {
  const parts = ciphertext.split('.');
  // 4 parts: salt.iv.authTag.data. Anything else — including the legacy 3-part
  // (unsalted) format — is rejected, so stale records are dropped on read.
  if (parts.length !== 4) throw new Error('Malformed ciphertext');
  const [saltB64, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const key = deriveKey(secret, Buffer.from(saltB64, 'base64url'));
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
