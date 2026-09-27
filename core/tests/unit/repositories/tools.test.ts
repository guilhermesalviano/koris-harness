import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolsRepository, ToolsRepositoryFactory } from '../../../src/repositories/tools';
import type { ToolDefinition } from '../../../../plugins/tools/contracts';

const mockTools: ToolDefinition[] = [
  {
    name: 'weather',
    schema: { description: 'Get weather', parameters: { type: 'object' } },
    enabled: vi.fn((opts) => opts.trusted && opts.agentName !== 'heartbeat'),
    handler: vi.fn(),
  },
  {
    name: 'admin_only',
    schema: { description: 'Admin tool', parameters: { type: 'object' } },
    enabled: vi.fn((opts) => opts.trusted),
    handler: vi.fn(),
  },
  {
    name: 'beat_tool',
    schema: { description: 'Beat schedule', parameters: { type: 'object' } },
    enabled: vi.fn((opts) => opts.agentName !== 'heartbeat'),
    handler: vi.fn(),
  },
];

vi.mock('../../../src/services/tools/registry-singleton', () => ({
  ToolPluginsSingleton: {
    getExistingInstance: vi.fn(() => mockTools),
  },
}));

describe('ToolsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transforms and returns all enabled tools by default', () => {
    const repo = ToolsRepositoryFactory.create();
    const result = repo.getAll();

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'weather',
        description: 'Get weather',
        parameters: { type: 'object' },
      },
    });
  });

  it('filters out beat tools when includeBeatTools is false', () => {
    const repo = new ToolsRepository();
    const result = repo.getAll({ includeBeatTools: false });

    // Weather and beat_tool both exclude 'heartbeat' agentName
    expect(result).toHaveLength(1);
    expect(result[0]?.function.name).toBe('admin_only');
  });

  it('passes trusted: false when untrusted senders are checked', () => {
    const repo = new ToolsRepository();
    const result = repo.getAll({ trusted: false });

    // Only beat_tool does not require trusted: true in our mock
    expect(result).toHaveLength(1);
    expect(result[0]?.function.name).toBe('beat_tool');
  });

  it('honours explicit agentName overrides', () => {
    const repo = new ToolsRepository();
    const result = repo.getAll({ agentName: 'heartbeat' });

    expect(result).toHaveLength(1);
    expect(result[0]?.function.name).toBe('admin_only');
  });
});
