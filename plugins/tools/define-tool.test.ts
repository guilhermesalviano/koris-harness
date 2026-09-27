import { describe, expect, it, vi } from 'vitest';
import { defineTool } from './define-tool';

describe('defineTool', () => {
  it('builds JSON Schema parameters from the flat parameter spec', () => {
    const definition = defineTool({
      name: 'greet',
      description: 'Greet someone by name.',
      parameters: {
        name: { type: 'string', required: true, description: 'The name to greet' },
      },
      handler: vi.fn(),
      enabled: () => true,
    });

    expect(definition.name).toBe('greet');
    expect(definition.schema).toEqual({
      description: 'Greet someone by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name to greet' },
        },
        required: ['name'],
      },
    });
  });

  it('omits unrequired parameters from the required list', () => {
    const definition = defineTool({
      name: 'search',
      description: 'Search for something.',
      parameters: {
        query: { type: 'string', required: true, description: 'Query string' },
        limit: { type: 'number', description: 'Max results' },
      },
      handler: vi.fn(),
      enabled: () => true,
    });

    expect(definition.schema.parameters).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query string' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    });
  });

  it('passes through arbitrary JSON Schema keywords other than required', () => {
    const definition = defineTool({
      name: 'send-message',
      description: 'Send a message.',
      parameters: {
        channel: { type: 'string', enum: ['telegram', 'whatsapp'], description: 'Channel' },
        data: { type: ['string', 'object'], description: 'Body' },
      },
      handler: vi.fn(),
      enabled: () => true,
    });

    expect(definition.schema.parameters).toEqual({
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['telegram', 'whatsapp'], description: 'Channel' },
        data: { type: ['string', 'object'], description: 'Body' },
      },
      required: [],
    });
  });

  it('defaults to an empty parameters object when none are given', () => {
    const definition = defineTool({
      name: 'list-beats',
      description: 'List all beats.',
      handler: vi.fn(),
      enabled: () => true,
    });

    expect(definition.schema.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('preserves the handler and enabled callbacks as given', async () => {
    const handler = vi.fn().mockResolvedValue({ toolName: 'greet', success: true });
    const enabled = vi.fn().mockReturnValue(false);

    const definition = defineTool({
      name: 'greet',
      description: 'Greet someone by name.',
      handler,
      enabled,
    });

    expect(definition.enabled({ trusted: true })).toBe(false);
    expect(enabled).toHaveBeenCalledWith({ trusted: true });

    await definition.handler({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }, {});
    expect(handler).toHaveBeenCalled();
  });
});
