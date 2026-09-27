import { describe, expect, it, vi } from 'vitest';

// Only the section table is under test — stub the pages and modal plumbing so
// importing it doesn't load the whole admin UI (and its coverage) into the run.
vi.mock('./GeneralPage', () => ({ default: () => null }));
vi.mock('./SessionsPage', () => ({ default: () => null }));
vi.mock('./PluginsPage', () => ({ default: () => null }));
vi.mock('./ProvidersPage', () => ({ default: () => null }));
vi.mock('./ChannelsPage', () => ({ default: () => null }));
vi.mock('./SkillsSettingsPage', () => ({ default: () => null }));
vi.mock('./MemoriesPage', () => ({ default: () => null }));
vi.mock('./HeartbeatsPage', () => ({ default: () => null }));
vi.mock('../../components/Modal', () => ({ default: () => null }));
vi.mock('../../components/Icons', () => ({
  ChannelsIcon: () => null,
  CloseIcon: () => null,
  HeartbeatsIcon: () => null,
  MemoriesIcon: () => null,
  PluginsIcon: () => null,
  ProvidersIcon: () => null,
  SessionsIcon: () => null,
  SettingsIcon: () => null,
  SkillsIcon: () => null,
}));
vi.mock('../../lib/config-save-context', () => ({ useSaveCoordinator: vi.fn(), useSaveStates: vi.fn() }));

import { SECTIONS } from './ConfigModal';

describe('ConfigModal sections and navigation', () => {
  it('defines all 8 standard workspace configuration sections', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toEqual(['general', 'sessions', 'plugins', 'providers', 'channels', 'skills', 'memories', 'beats']);
  });

  it('provides non-empty labels, descriptions, icons, and component mappings for all sections', () => {
    for (const section of SECTIONS) {
      expect(section.id).toBeTruthy();
      expect(section.label).toBeTruthy();
      expect(section.description).toBeTruthy();
      expect(section.Icon).toBeDefined();
      expect(section.Component).toBeDefined();
    }
  });

  it('recognizes valid section IDs for direct deeplinking', () => {
    const isValidSection = (id?: string) => SECTIONS.some((s) => s.id === id);
    expect(isValidSection('providers')).toBe(true);
    expect(isValidSection('channels')).toBe(true);
    expect(isValidSection('plugins')).toBe(true);
    expect(isValidSection('skills')).toBe(true);
    expect(isValidSection('memories')).toBe(true);
    expect(isValidSection('beats')).toBe(true);
    expect(isValidSection('sessions')).toBe(true);
    expect(isValidSection('general')).toBe(true);
    expect(isValidSection('unknown')).toBe(false);
    expect(isValidSection(undefined)).toBe(false);
  });
});
