import { getAIProvider } from "./providers";
import { ILogger } from "../infrastructure/logger";
import { nowISO } from "../utils/date";

async function healthCheck(logger: ILogger): Promise<{ status: 'ok' | 'error'; timestamp: string; details?: string }> {
  const provider = getAIProvider(logger);
  try {
    const health = await provider.healthCheck();
    return { status: health.ok === true ? 'ok' : 'error', timestamp: nowISO() };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: 'error', timestamp: nowISO(), details: detail };
  }
}

export { healthCheck };