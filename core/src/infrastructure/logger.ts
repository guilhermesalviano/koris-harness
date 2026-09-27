import {
  Logger as WinstonLogger, createLogger, format, LoggerOptions, transports,
} from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { sanitizeLogText, sanitizeMeta } from '../utils/sanitize-log-text';
import { nowISO } from '../utils/date';
import type { ILogger } from '../../../plugins/channels/contracts';

export type { ILogger };

function reorderedJsonLogs() {
  return format((info) => {
    const { level, message, date, ...details } = info;
    const ordered: Record<string, unknown> = { message, level, ...details };
    if (date !== undefined) {
      ordered.date = date;
    }
    info[Symbol.for('message')] = JSON.stringify(ordered);
    return info;
  })();
}

class Logger implements ILogger {
  logger: WinstonLogger;

  constructor(logger: WinstonLogger) {
    this.logger = logger;
  }

  private log(level: 'info' | 'error' | 'debug' | 'warn', message: string, meta?: Record<string, unknown>) {
    const safeMessage = sanitizeLogText(message);
    const safeMeta = sanitizeMeta(meta);
    return this.logger.log(level, safeMessage, safeMeta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    return this.log('info', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    return this.log('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    return this.log('debug', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    return this.log('warn', message, meta);
  }
}

class LoggerFactory {
  static getOptions(silenceConsole = false) {
    const logsDir = path.join(config.DATA_DIR, 'logs');

    const activeTransports: any[] = [];

    if (!silenceConsole) {
      activeTransports.push(new transports.Console());
    }

    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      activeTransports.push(
        new transports.File({ 
          filename: path.join(logsDir, 'combined.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        new transports.File({ 
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );
    } catch (error) {
      if (!silenceConsole) {
        console.warn(`[LoggerFactory] Warning: Could not create log directory at ${logsDir}. Falling back to Console-only logging.`, error);
        // Ensure at least console transport is present when file setup fails
        if (!activeTransports.some(t => t instanceof transports.Console)) {
          activeTransports.push(new transports.Console());
        }
      }
    }

    const options: LoggerOptions = {
      level: config.LOG_LEVEL || 'info',
      format: reorderedJsonLogs(),
      defaultMeta: {
        date: nowISO(),
      },
      transports: activeTransports,
    };

    return options;
  }

  static create(silenceConsole?: boolean): ILogger {
    // Auto-detect TUI mode from env var set before any modules load.
    const shouldSilence = silenceConsole ?? process.env.LOG_SILENCE_CONSOLE === 'true';
    const logger = createLogger(LoggerFactory.getOptions(shouldSilence));
    return new Logger(logger);
  }
}

export { Logger, LoggerFactory };