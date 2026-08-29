// ============================================
// Clous — EncryptionHelper (AES-256-GCM)
// ============================================

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;
const ENCRYPTED_PREFIX = 'ENC:';

/**
 * AES-256-GCM encryption helper for securing sensitive configuration values.
 */
export class EncryptionHelper {
  private key: Buffer;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 8) {
      throw new Error('Encryption key must be at least 8 characters long');
    }
    // Derive a 256-bit key from the passphrase
    const salt = crypto.createHash('sha256').update(encryptionKey).digest();
    this.key = crypto.pbkdf2Sync(encryptionKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');
  }

  /**
   * Encrypt a string value using AES-256-GCM.
   * Returns a prefixed, base64-encoded string containing IV + auth tag + ciphertext.
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Pack: IV (16) + Tag (16) + Ciphertext
    const packed = Buffer.concat([iv, tag, encrypted]);
    return ENCRYPTED_PREFIX + packed.toString('base64');
  }

  /**
   * Decrypt a value that was encrypted with `encrypt()`.
   * Expects the ENC: prefix; returns original plaintext.
   */
  decrypt(encryptedValue: string): string {
    if (!EncryptionHelper.isEncrypted(encryptedValue)) {
      throw new Error('Value is not an encrypted string (missing ENC: prefix)');
    }

    const packed = Buffer.from(encryptedValue.slice(ENCRYPTED_PREFIX.length), 'base64');

    if (packed.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid encrypted value: data too short');
    }

    const iv = packed.subarray(0, IV_LENGTH);
    const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error('Decryption failed: invalid key or corrupted data');
    }
  }

  /**
   * Check whether a value is an encrypted string.
   */
  static isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
  }
}
