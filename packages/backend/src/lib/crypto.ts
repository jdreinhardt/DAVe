import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM

function deriveKey(secret: string): Buffer {
  // SHA-256 gives us a stable 32-byte key from the session secret.
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(ciphertext: string, secret: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const key = deriveKey(secret);
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
