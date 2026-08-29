// ============================================
// Clous — Logger (Winston-based)
// ============================================

import winston from 'winston';
import type { LogLevel } from '../types';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const clousFormat = printf(({ level, message, timestamp: ts, stack, module: mod, ...meta }) => {
  const moduleTag = mod ? `[${mod}]` : '';
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const errorStack = stack ? `\n${stack}` : '';
  return `${ts} ${level} ${moduleTag} ${message}${metaStr}${errorStack}`;
});

/**
 * Configurable logger built on Winston.
 * Supports console + file output with structured metadata.
 */
export class Logger {
  private logger: winston.Logger;

  constructor(level: LogLevel = 'info', logFile?: string) {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: combine(
          colorize({ all: true }),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          errors({ stack: true }),
          clousFormat,
        ),
      }),
    ];

    if (logFile) {
      transports.push(
        new winston.transports.File({
          filename: logFile,
          format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            errors({ stack: true }),
            clousFormat,
          ),
        }),
      );
    }

    this.logger = winston.createLogger({
      level,
      transports,
      exitOnError: false,
    });
  }

  /**
   * Create a child logger scoped to a module name.
   */
  child(moduleName: string): ModuleLogger {
    return new ModuleLogger(this.logger, moduleName);
  }

  /** Log an error message. */
  error(message: string, meta?: Record<string, any>): void {
    this.logger.error(message, meta);
  }

  /** Log a warning message. */
  warn(message: string, meta?: Record<string, any>): void {
    this.logger.warn(message, meta);
  }

  /** Log an informational message. */
  info(message: string, meta?: Record<string, any>): void {
    this.logger.info(message, meta);
  }

  /** Log a debug message. */
  debug(message: string, meta?: Record<string, any>): void {
    this.logger.debug(message, meta);
  }

  /** Log a verbose message. */
  verbose(message: string, meta?: Record<string, any>): void {
    this.logger.verbose(message, meta);
  }

  /** Set the log level. */
  setLevel(level: LogLevel): void {
    this.logger.level = level;
  }
}

/**
 * Module-scoped logger that attaches a module tag to all messages.
 */
export class ModuleLogger {
  constructor(
    private logger: winston.Logger,
    private moduleName: string,
  ) {}

  error(message: string, meta?: Record<string, any>): void {
    this.logger.error(message, { module: this.moduleName, ...meta });
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.logger.warn(message, { module: this.moduleName, ...meta });
  }

  info(message: string, meta?: Record<string, any>): void {
    this.logger.info(message, { module: this.moduleName, ...meta });
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.logger.debug(message, { module: this.moduleName, ...meta });
  }

  verbose(message: string, meta?: Record<string, any>): void {
    this.logger.verbose(message, { module: this.moduleName, ...meta });
  }
}
