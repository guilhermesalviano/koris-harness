import { ILogger } from "../infrastructure/logger";

export function hasFlag(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag) || argv.includes(`--${flag}`);
}

export function logError(logger: ILogger, message: string, error: unknown): void {
  logger.error(message, {
    error: error instanceof Error ? error.message : String(error),
  });
}