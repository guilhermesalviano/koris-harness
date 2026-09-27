import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { Logger, LoggerFactory } from '../../../src/infrastructure/logger';

describe('Logger infrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Logger instance', () => {
    it('sanitizes and logs at info, debug, warn, and error levels', () => {
      const winstonMock = { log: vi.fn() };
      const logger = new Logger(winstonMock as never);

      logger.info('hello\r\nworld', { key: 'val' });
      expect(winstonMock.log).toHaveBeenCalledWith('info', 'hello\\r\\nworld', { key: 'val' });

      logger.debug('debug message');
      expect(winstonMock.log).toHaveBeenCalledWith('debug', 'debug message', undefined);

      logger.warn('warning message', { alert: true });
      expect(winstonMock.log).toHaveBeenCalledWith('warn', 'warning message', { alert: true });

      logger.error('error message', { code: 500 });
      expect(winstonMock.log).toHaveBeenCalledWith('error', 'error message', { code: 500 });
    });
  });

  describe('LoggerFactory', () => {
    it('creates logger options with console and file transports by default', () => {
      const options = LoggerFactory.getOptions(false);
      expect(options.level).toBeDefined();
      expect(options.transports).toBeDefined();
      expect(Array.isArray(options.transports)).toBe(true);
    });

    it('silences console transport when requested', () => {
      const options = LoggerFactory.getOptions(true);
      const hasConsole = (options.transports as any[]).some(
        (t) => t.constructor.name === 'Console',
      );
      expect(hasConsole).toBe(false);
    });

    it('falls back to console logging when file transport setup throws', () => {
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const options = LoggerFactory.getOptions(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[LoggerFactory] Warning: Could not create log directory'),
        expect.any(Error),
      );
      expect(options.transports).toBeDefined();

      mkdirSpy.mockRestore();
      existsSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('creates an ILogger instance via LoggerFactory.create()', () => {
      const logger = LoggerFactory.create(true);
      expect(logger).toBeInstanceOf(Logger);
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.warn).toBe('function');
    });
  });
});
