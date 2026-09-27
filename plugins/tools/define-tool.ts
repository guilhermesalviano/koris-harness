import type { ToolDefinition, ToolFilterOptions, ToolHandler } from './contracts';

/**
 * One parameter's JSON Schema, plus `required` inlined instead of living in a
 * separate top-level `required: string[]` array. Any other JSON Schema
 * keyword (`enum`, `items`, `properties`, `minimum`, ...) passes through
 * as-is — `defineTool` only special-cases `required`.
 */
export interface ToolParameterSpec {
  type: string | string[];
  description?: string;
  required?: boolean;
  [jsonSchemaKeyword: string]: unknown;
}

export interface DefineToolInput {
  /** The LLM-facing tool name, e.g. 'send_message'. */
  name: string;
  description: string;
  /** Keyed by parameter name. Omit for a tool that takes no arguments. */
  parameters?: Record<string, ToolParameterSpec>;
  handler: ToolHandler;
  enabled: (opts: ToolFilterOptions) => boolean;
}

/**
 * Builds a `ToolDefinition` from a flat, per-parameter config object instead
 * of hand-written JSON Schema (`{type: 'object', properties, required}`).
 * Purely a friendlier authoring shape — the resulting `schema.parameters` is
 * the same JSON Schema `ToolDefinition` always expected.
 */
export function defineTool(input: DefineToolInput): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [paramName, spec] of Object.entries(input.parameters ?? {})) {
    const { required: isRequired, ...jsonSchema } = spec;
    properties[paramName] = jsonSchema;
    if (isRequired) required.push(paramName);
  }

  return {
    name: input.name,
    schema: {
      description: input.description,
      parameters: { type: 'object', properties, required },
    },
    handler: input.handler,
    enabled: input.enabled,
  };
}
