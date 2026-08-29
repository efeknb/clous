// ============================================
// Clous — Checksum Utility
// ============================================

import * as crypto from 'crypto';

/**
 * Checksum utility for data integrity verification.
 * Supports SHA-256 (default) and MD5 algorithms.
 */
export class Checksum {
  /**
   * Compute a SHA-256 hash of the given data.
   */
  static sha256(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Compute an MD5 hash of the given data.
   */
  static md5(data: string | Buffer): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Compute a hash using a custom algorithm.
   */
  static hash(data: string | Buffer, algorithm: string = 'sha256'): string {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }

  /**
   * Compute a checksum for any serializable object.
   * Objects are JSON-serialized with sorted keys for deterministic output.
   */
  static fromObject(obj: any, algorithm: string = 'sha256'): string {
    const serialized = JSON.stringify(obj, Object.keys(obj).sort());
    return Checksum.hash(serialized, algorithm);
  }

  /**
   * Verify that data matches a given checksum.
   */
  static verify(data: string | Buffer, expectedChecksum: string, algorithm: string = 'sha256'): boolean {
    const actual = Checksum.hash(data, algorithm);
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedChecksum, 'hex'));
  }

  /**
   * Verify that an object matches a given checksum.
   */
  static verifyObject(obj: any, expectedChecksum: string, algorithm: string = 'sha256'): boolean {
    const actual = Checksum.fromObject(obj, algorithm);
    try {
      return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedChecksum, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Generate a unique ID using crypto.randomUUID.
   */
  static generateId(): string {
    return crypto.randomUUID();
  }
}
