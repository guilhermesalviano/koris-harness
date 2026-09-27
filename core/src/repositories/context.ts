import os from 'node:os';
import { config } from '../config';
import { nowISO } from '../utils/date';

export type PersonalInformation = Record<string, string>;

export interface SystemInfo {
  source: string;
  platform: string;
  datetime: string;
}

interface IContextRepository {
  get(params: { channel: string }): string;
}

class ContextRepository implements IContextRepository {

  /**
   * Load and format system info in one call (convenience method)
   */
  get(params: { channel: string }): string {
    const systemInfo = this.getSystemInfo(params);
    const personalInfo = this.getPersonalInfo(config.PERSONAL_INFORMATION);
    return this.formatAsPrompt(systemInfo, personalInfo);
  }

  /**
   * Collect current system information
   */
  private getSystemInfo(params: { channel: string }): SystemInfo {
    return {
      source: params.channel,
      platform: os.platform(),
      datetime: nowISO(),
    };
  }

  private getPersonalInfo(params: Record<string, string>): PersonalInformation {
    return Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  /**
   * Format system info as prompt text
   * inactivated temporarily
   */
  private formatAsPrompt(system: SystemInfo, personal: PersonalInformation): string {
    const personalLines = Object.entries(personal).map(([key, value]) => `- ${key}: ${value}`);
    return [
      "# Before responding, consider the following context information:",
      system.datetime ? `1. Datetime: ${system.datetime}` : null,
      system.source ? `2. Channel Source: ${system.source}` : null,
      system.platform ? `3. Platform: ${system.platform}` : null,
      `4. Main Human Information:`,
      ...personalLines,
    ].join('\n');
  }
}

class ContextRepositoryFactory {
  static create(): IContextRepository {
    return new ContextRepository();
  }
}

export { IContextRepository, ContextRepository, ContextRepositoryFactory };