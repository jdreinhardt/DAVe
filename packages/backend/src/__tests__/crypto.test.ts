import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../lib/crypto.js';

const SECRET = 'test-secret-32-chars-minimum-here!!';

describe('encrypt / decrypt', () => {
  it('round-trips plain ASCII', () => {
    const plain = 'hello world';
    expect(decrypt(encrypt(plain, SECRET), SECRET)).toBe(plain);
  });

  it('round-trips unicode', () => {
    const plain = 'こんにちは 🌍';
    expect(decrypt(encrypt(plain, SECRET), SECRET)).toBe(plain);
  });

  it('round-trips empty string', () => {
    expect(decrypt(encrypt('', SECRET), SECRET)).toBe('');
  });

  it('round-trips a JSON payload', () => {
    const plain = JSON.stringify({ user: 'alice', password: 's3cr3t' });
    expect(decrypt(encrypt(plain, SECRET), SECRET)).toBe(plain);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const plain = 'same input';
    expect(encrypt(plain, SECRET)).not.toBe(encrypt(plain, SECRET));
  });

  it('different secrets produce different ciphertext', () => {
    const plain = 'test';
    const ct1 = encrypt(plain, SECRET);
    const ct2 = encrypt(plain, 'another-secret-32-chars-minimum!');
    expect(ct1).not.toBe(ct2);
  });

  it('throws with wrong secret', () => {
    const ct = encrypt('secret data', SECRET);
    expect(() => decrypt(ct, 'wrong-secret-that-is-32-chars-!!')).toThrow();
  });

  it('throws on malformed ciphertext (wrong number of parts)', () => {
    expect(() => decrypt('a.b.c.d.e', SECRET)).toThrow('Malformed ciphertext');
    expect(() => decrypt('onlyonepart', SECRET)).toThrow('Malformed ciphertext');
    expect(() => decrypt('two.parts', SECRET)).toThrow('Malformed ciphertext');
    // Legacy unsalted 3-part format (iv.tag.data) is no longer accepted —
    // stale sessions are dropped on read rather than decrypted.
    expect(() => decrypt('aaa.bbb.ccc', SECRET)).toThrow('Malformed ciphertext');
  });

  it('produces the 4-part salt.iv.tag.data format', () => {
    expect(encrypt('x', SECRET).split('.')).toHaveLength(4);
  });

  it('uses a distinct per-record salt each call', () => {
    const salt1 = encrypt('same', SECRET).split('.')[0];
    const salt2 = encrypt('same', SECRET).split('.')[0];
    expect(salt1).not.toBe(salt2);
  });

  it('throws on tampered auth tag (GCM integrity check)', () => {
    const ct = encrypt('data', SECRET);
    const parts = ct.split('.');
    // Flip the first character of the auth tag (parts[2] in salt.iv.tag.data) —
    // first char is never padding so this always changes the decoded bytes and
    // triggers GCM verification failure.
    const tag = parts[2]!;
    const flipped = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    const tampered = [parts[0], parts[1], flipped, parts[3]].join('.');
    expect(() => decrypt(tampered, SECRET)).toThrow();
  });
});
