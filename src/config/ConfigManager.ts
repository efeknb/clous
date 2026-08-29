// ============================================
// Clous — ConfigManager (.env Management)
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { EncryptionHelper } from './EncryptionHelper';
import { EventBus } from '../utils/EventBus';
import type { ModuleLogger } from '../utils/Logger';
import type { ConfigManagerOptions, ConfigSchema } from '../types';

/**
 * Configuration manager with .env file support, encryption,
 * environment profiles, and runtime value updates.
 */
export class ConfigManager {
  private values: Map<string, string> = new Map();
  private defaults: Map<string, string | number | boolean> = new Map();
  private encryption: EncryptionHelper | null = null;
  private envPath: string;
  private env: string;
  private loaded: boolean = false;

  constructor(
    private events: EventBus,
    private logger: ModuleLogger,
    options: ConfigManagerOptions = {},
  ) {
    this.envPath = options.envPath || './.env';
    this.env = options.env || process.env.NODE_ENV || 'development';

    if (options.encryptionKey) {
      this.encryption = new EncryptionHelper(options.encryptionKey);
    }
  }

  /**
   * Load configuration from .env file(s).
   * Loads base .env first, then environment-specific .env.<env> file.
   */
  async load(): Promise<void> {
    // Load base .env
    this.loadEnvFile(this.envPath);

    // Load environment-specific .env file (e.g., .env.production)
    const envSpecificPath = `${this.envPath}.${this.env}`;
    if (fs.existsSync(envSpecificPath)) {
      this.loadEnvFile(envSpecificPath);
      this.logger.debug(`Loaded environment-specific config: ${envSpecificPath}`);
    }

    // Override from process.env (environment variables take precedence)
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('CLOUS_') && value !== undefined) {
        this.values.set(key, value);
      }
    }

    // Apply defaults for missing values
    for (const [key, defaultValue] of this.defaults) {
      if (!this.values.has(key)) {
        this.values.set(key, String(defaultValue));
      }
    }

    this.loaded = true;
    this.logger.info(`Configuration loaded (env: ${this.env})`);
    this.events.emit('config:loaded', this.env);
  }

  /**
   * Get a configuration value by key.
   * Automatically decrypts values with ENC: prefix if encryption is configured.
   */
  get(key: string, defaultValue?: string): string | undefined {
    let value = this.values.get(key) ?? process.env[key] ?? defaultValue;

    // Auto-decrypt encrypted values
    if (value && EncryptionHelper.isEncrypted(value) && this.encryption) {
      try {
        value = this.encryption.decrypt(value);
      } catch (error) {
        this.logger.error(`Failed to decrypt config value: ${key}`, {
          error: (error as Error).message,
        });
      }
    }

    return value;
  }

  /**
   * Get a configuration value as a number.
   */
  getNumber(key: string, defaultValue?: number): number | undefined {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get a configuration value as a boolean.
   */
  getBoolean(key: string, defaultValue?: boolean): boolean | undefined {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    return value === 'true' || value === '1' || value === 'yes';
  }

  /**
   * Set a configuration value at runtime.
   */
  set(key: string, value: string | number | boolean): void {
    const strValue = String(value);
    const oldValue = this.values.get(key);
    this.values.set(key, strValue);

    if (oldValue !== strValue) {
      this.events.emit('config:changed', key, strValue);
      this.logger.debug(`Config value changed: ${key}`);
    }
  }

  /**
   * Set an encrypted value.
   * Requires encryption key to be configured.
   */
  setEncrypted(key: string, plainValue: string): void {
    if (!this.encryption) {
      throw new Error('Encryption key is not configured. Set encryptionKey in ClousConfig.');
    }
    const encrypted = this.encryption.encrypt(plainValue);
    this.values.set(key, encrypted);
    this.events.emit('config:changed', key, '[encrypted]');
  }

  /**
   * Register default values for configuration keys.
   */
  setDefaults(defaults: Record<string, string | number | boolean>): void {
    for (const [key, value] of Object.entries(defaults)) {
      this.defaults.set(key, value);
      if (!this.values.has(key)) {
        this.values.set(key, String(value));
      }
    }
  }

  /**
   * Validate configuration against a schema.
   */
  validate(schema: ConfigSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [key, def] of Object.entries(schema)) {
      const value = this.get(key);

      if (def.required && (value === undefined || value === '')) {
        errors.push(`Required config key missing: ${key}`);
        continue;
      }

      if (value !== undefined && value !== '') {
        switch (def.type) {
          case 'number':
            if (isNaN(Number(value))) {
              errors.push(`Config key "${key}" must be a number, got: "${value}"`);
            }
            break;
          case 'boolean':
            if (!['true', 'false', '1', '0', 'yes', 'no'].includes(value.toLowerCase())) {
              errors.push(`Config key "${key}" must be a boolean, got: "${value}"`);
            }
            break;
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check whether the configuration has been loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get the current environment name.
   */
  getEnvironment(): string {
    return this.env;
  }

  /**
   * Get all configuration values as a plain object.
   * Encrypted values are NOT decrypted in the output.
   */
  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.values) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Check if a key exists in the configuration.
   */
  has(key: string): boolean {
    return this.values.has(key) || process.env[key] !== undefined;
  }

  /**
   * Save current configuration to .env file.
   */
  async save(targetPath?: string): Promise<void> {
    const savePath = targetPath || this.envPath;
    const lines: string[] = [
      '# ============================================',
      '# Clous — Configuration (auto-generated)',
      `# Generated at: ${new Date().toISOString()}`,
      '# ============================================',
      '',
    ];

    for (const [key, value] of this.values) {
      // Quote values with spaces
      const needsQuote = value.includes(' ') || value.includes('#');
      lines.push(`${key}=${needsQuote ? `"${value}"` : value}`);
    }

    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(savePath, lines.join('\n') + '\n', 'utf8');
    this.logger.info(`Configuration saved to ${savePath}`);
  }

  // ── Private ──────────────────────────────────

  private loadEnvFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      this.logger.debug(`Env file not found: ${resolved} (skipping)`);
      return;
    }

    try {
      const parsed = dotenv.parse(fs.readFileSync(resolved, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        this.values.set(key, value);
      }
      this.logger.debug(`Loaded env file: ${resolved} (${Object.keys(parsed).length} keys)`);
    } catch (error) {
      this.logger.error(`Failed to parse env file: ${resolved}`, {
        error: (error as Error).message,
      });
    }
  }
}
