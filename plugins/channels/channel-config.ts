import { definePluginConfig } from '../config/define-config';
import type {
  PluginConfigDefinition,
  PluginConfigFieldSpec,
  PluginConfigModule,
  PluginConfigSchema,
  LoadPluginConfigOptions,
  WritePluginConfigOptions,
} from '../config/define-config';

export type ChannelConfigFieldSpec<TValue> = PluginConfigFieldSpec<TValue>;
export type ChannelConfigSchema<TConfig> = PluginConfigSchema<TConfig>;
export type LoadChannelConfigOptions = LoadPluginConfigOptions;
export type WriteChannelConfigOptions = WritePluginConfigOptions;
export type ChannelConfigModule<TConfig> = PluginConfigModule<TConfig>;
export type ChannelConfigDefinition<TConfig> = Omit<PluginConfigDefinition<TConfig>, 'family'>;

export function defineChannelConfig<TConfig>(
  definition: ChannelConfigDefinition<TConfig>,
): ChannelConfigModule<TConfig> {
  return definePluginConfig<TConfig>({ ...definition, family: 'channels' });
}
