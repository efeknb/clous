// ============================================
// Clous — ConfigManager & EncryptionHelper Tests
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EncryptionHelper } from '../src/config/EncryptionHelper';
import { ConfigManager } from '../src/config/ConfigManager';
import { EventBus } from '../src/utils/EventBus';
import { Logger } from '../src/utils/Logger';

describe('EncryptionHelper', () => {
  const key = 'test-encryption-key-12345';
  let helper: EncryptionHelper;

  beforeEach(() => {
    helper = new EncryptionHelper(key);
  });

  test('should encrypt and decrypt a string', () => {
    const plaintext = 'my-secret-database-url';
    const encrypted = helper.encrypt(plaintext);
    const decrypted = helper.decrypt(encrypted);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith('ENC:')).toBe(true);
    expect(decrypted).toBe(plaintext);
  });

  test('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same-text';
    const enc1 = helper.encrypt(plaintext);
    const enc2 = helper.encrypt(plaintext);

    expect(enc1).not.toBe(enc2); // Different IVs
    expect(helper.decrypt(enc1)).toBe(plaintext);
    expect(helper.decrypt(enc2)).toBe(plaintext);
  });

  test('should detect encrypted values', () => {
    expect(EncryptionHelper.isEncrypted('ENC:abc123')).toBe(true);
    expect(EncryptionHelper.isEncrypted('plain-value')).toBe(false);
    expect(EncryptionHelper.isEncrypted('')).toBe(false);
  });

  test('should throw on decryption with wrong key', () => {
    const encrypted = helper.encrypt('secret');
    const wrongHelper = new EncryptionHelper('wrong-key-12345678');

    expect(() => wrongHelper.decrypt(encrypted)).toThrow('Decryption failed');
  });

  test('should throw on short encryption key', () => {
    expect(() => new EncryptionHelper('short')).toThrow('at least 8 characters');
  });

  test('should throw on non-encrypted value', () => {
    expect(() => helper.decrypt('not-encrypted')).toThrow('missing ENC: prefix');
  });

  test('should handle empty string encryption', () => {
    const encrypted = helper.encrypt('');
    expect(helper.decrypt(encrypted)).toBe('');
  });

  test('should handle unicode strings', () => {
    const plaintext = 'Merhaba Dünya! 🌍 日本語';
    const encrypted = helper.encrypt(plaintext);
    expect(helper.decrypt(encrypted)).toBe(plaintext);
  });
});





describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let events: EventBus;
  let tempDir: string;
  let envPath: string;

  beforeEach(() => {
    events = new EventBus();
    const logger = new Logger('error');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clous-config-test-'));
    envPath = path.join(tempDir, '.env');

    configManager = new ConfigManager(events, logger.child('Config'), {
      envPath,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should load from .env file', async () => {
    fs.writeFileSync(envPath, 'CLOUS_TEST_KEY=test-value\nCLOUS_NUM=42\n');

    await configManager.load();

    expect(configManager.get('CLOUS_TEST_KEY')).toBe('test-value');
    expect(configManager.get('CLOUS_NUM')).toBe('42');
    expect(configManager.isLoaded()).toBe(true);
  });

  test('should return default value for missing key', async () => {
    await configManager.load();

    expect(configManager.get('MISSING_KEY', 'default')).toBe('default');
    expect(configManager.get('MISSING_KEY')).toBeUndefined();
  });

  test('should get number values', async () => {
    fs.writeFileSync(envPath, 'CLOUS_PORT=3000\nCLOUS_INVALID=abc\n');
    await configManager.load();

    expect(configManager.getNumber('CLOUS_PORT')).toBe(3000);
    expect(configManager.getNumber('CLOUS_INVALID', 8080)).toBe(8080);
    expect(configManager.getNumber('MISSING', 5000)).toBe(5000);
  });

  test('should get boolean values', async () => {
    fs.writeFileSync(envPath, 'CLOUS_ENABLED=true\nCLOUS_DEBUG=1\nCLOUS_OFF=false\n');
    await configManager.load();

    expect(configManager.getBoolean('CLOUS_ENABLED')).toBe(true);
    expect(configManager.getBoolean('CLOUS_DEBUG')).toBe(true);
    expect(configManager.getBoolean('CLOUS_OFF')).toBe(false);
  });

  test('should set values at runtime', async () => {
    await configManager.load();

    configManager.set('CLOUS_RUNTIME', 'dynamic-value');
    expect(configManager.get('CLOUS_RUNTIME')).toBe('dynamic-value');
  });

  test('should emit config:changed event', async () => {
    await configManager.load();

    const changes: any[] = [];
    events.on('config:changed', (key: string, value: any) => {
      changes.push({ key, value });
    });

    configManager.set('CLOUS_NEW', 'value1');
    configManager.set('CLOUS_NEW', 'value2');

    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ key: 'CLOUS_NEW', value: 'value1' });
  });

  test('should apply defaults', async () => {
    configManager.setDefaults({
      CLOUS_DEFAULT_A: 'alpha',
      CLOUS_DEFAULT_B: 42,
    });

    await configManager.load();

    expect(configManager.get('CLOUS_DEFAULT_A')).toBe('alpha');
    expect(configManager.get('CLOUS_DEFAULT_B')).toBe('42');
  });

  test('should validate schema', async () => {
    fs.writeFileSync(envPath, 'CLOUS_PORT=abc\nCLOUS_NAME=test\n');
    await configManager.load();

    const result = configManager.validate({
      CLOUS_PORT: { type: 'number', required: true },
      CLOUS_NAME: { type: 'string', required: true },
      CLOUS_MISSING: { type: 'string', required: true },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2); // PORT not a number, MISSING required
  });

  test('should save config to file', async () => {
    await configManager.load();

    configManager.set('CLOUS_SAVE_TEST', 'saved-value');
    const savePath = path.join(tempDir, '.env.saved');
    await configManager.save(savePath);

    const content = fs.readFileSync(savePath, 'utf8');
    expect(content).toContain('CLOUS_SAVE_TEST=saved-value');
  });

  test('should check key existence', async () => {
    fs.writeFileSync(envPath, 'CLOUS_EXISTS=yes\n');
    await configManager.load();

    expect(configManager.has('CLOUS_EXISTS')).toBe(true);
    expect(configManager.has('CLOUS_NOPE')).toBe(false);
  });

  test('should handle encrypted values', async () => {
    const encHelper = new EncryptionHelper('test-key-12345');
    const encrypted = encHelper.encrypt('secret-db-url');

    fs.writeFileSync(envPath, `CLOUS_DB_URL=${encrypted}\n`);

    const encConfig = new ConfigManager(
      events,
      new Logger('error').child('Config'),
      { envPath, encryptionKey: 'test-key-12345' },
    );

    await encConfig.load();

    expect(encConfig.get('CLOUS_DB_URL')).toBe('secret-db-url');
  });
});

function expect<T>(actual: T): any {
  return (globalThis as typeof globalThis & {
    expect: (value: T) => any;
  }).expect(actual);
}

