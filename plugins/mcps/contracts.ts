import { ExtensionPoint } from '../registry';

export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface McpServerConfig {
  url: string;
  bearerToken?: string;
}

export interface McpServerDefinition {
  name: string;
  enabled(): boolean;
  loadConfig(): McpServerConfig;
  writeConfigPatch?(patch: Record<string, unknown>): void;
}

export interface IPluginEnablementGateway {
  isEnabled(name: string): boolean;
}

export interface McpPluginContext {
  logger: ILogger;
  pluginEnablement: IPluginEnablementGateway;
}

export const MCP_SERVERS = new ExtensionPoint<McpServerDefinition>('mcps.servers');

export { ExtensionPoint };
export type { Plugin, PluginRegistry } from '../registry';
