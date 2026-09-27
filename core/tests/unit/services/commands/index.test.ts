import { describe, it, expect, vi, afterEach } from 'vitest';
import { config } from '../../../../src/config';

const getRecent = vi.fn().mockReturnValue([
  { name: 'cat-fact', description: 'Random cat facts', content: 'Call catfact.ninja.' },
  { name: 'weather', description: 'Forecasts', content: 'Call wttr.in.' },
]);

vi.mock('../../../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: { create: () => ({}) },
}));

vi.mock('../../../../src/repositories/learned-skills', () => ({
  LearnedSkillsRepositoryFactory: { create: () => ({ getRecent }) },
}));

vi.mock('../../../../src/services/tools/registry-singleton', () => ({
  ToolPluginsSingleton: {
    getExistingInstance: vi.fn(() => [
      { name: 'curl_request', schema: { description: 'Curl tool' }, enabled: vi.fn(() => true) },
      { name: 'search_engine', schema: { description: 'Search tool' }, enabled: vi.fn(() => true) },
    ]),
  },
}));

import { getAvailableCommands, handleCommand, isCommand } from '../../../../src/services/commands';

const originalSkillsMode = config.SKILLS.MODE;

function setSkillsMode(mode: 'auto' | 'manual') {
  (config.SKILLS as { MODE: string }).MODE = mode;
}

describe('Command Handler', () => {
  describe('isCommand', () => {
    it('recognizes known commands and their aliases', () => {
      expect(isCommand('/help')).toBe(true);
      expect(isCommand('/status')).toBe(true);
      expect(isCommand('/reset')).toBe(true); // alias of /clear
      expect(isCommand('/USAGE 7')).toBe(true); // case- and arg-insensitive
      expect(isCommand('/tools')).toBe(true);
      expect(isCommand('/channels')).toBe(true);
      expect(isCommand('/mcps')).toBe(true);
      expect(isCommand('/skills')).toBe(true);
    });

    it('does not recognize an unknown slash message — it flows to the agent', () => {
      expect(isCommand('/shrug')).toBe(false);
      expect(isCommand('/path/to/file.ts')).toBe(false);
    });

    it('should not recognize non-commands', () => {
      expect(isCommand('hello')).toBe(false);
      expect(isCommand('read file.ts')).toBe(false);
      expect(isCommand('list src/')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(isCommand('')).toBe(false);
    });
  });

  describe('handleCommand', () => {
    it('should handle /help command', async () => {
      const result = await handleCommand('/help', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.response).toBeTruthy();
    });

    it('should handle /status command', async () => {
      const result = await handleCommand('/status', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.response).toBeTruthy();
    });

    it('should handle /clear command', async () => {
      const result = await handleCommand('/clear', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('clear');
    });

    it('treats /reset as an alias of /clear', async () => {
      const result = await handleCommand('/reset', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('clear');
    });

    it('handles /whoami with the sender access level', async () => {
      const trusted = await handleCommand('/whoami', { source: 'tui', trusted: true, originId: 'user-9' });
      expect(trusted.handled).toBe(true);
      expect(trusted.response).toContain('trusted');
      expect(trusted.response).toContain('user-9');

      const standard = await handleCommand('/whoami', { source: 'telegram', trusted: false });
      expect(standard.response?.toLowerCase()).toContain('standard');
    });

    it('handles /memory by delegating to the gateway via a memory action', async () => {
      const result = await handleCommand('/memory', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('memory');
    });

    it('gives per-command detail for /help <command>', async () => {
      const result = await handleCommand('/help compact', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('/compact');
      expect(result.response).toContain('summary');
    });

    it('reports an unknown argument to /help', async () => {
      const result = await handleCommand('/help nope', { source: 'tui' });
      expect(result.response).toContain('Unknown command: nope');
    });

    it('should handle /compact command', async () => {
      const result = await handleCommand('/compact', { source: 'tui' });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('compact');
      expect(result.response).toBeTruthy();
    });

    it('parses /mode with no arg as a query', async () => {
      const result = await handleCommand('/mode', { source: 'whatsapp' });
      expect(result).toEqual({ action: 'mode', handled: true });
    });

    it('parses /mode voice and /mode text', async () => {
      expect(await handleCommand('/mode voice', { source: 'whatsapp' })).toEqual({
        action: 'mode',
        mode: 'voice',
        handled: true,
      });
      expect(await handleCommand('/mode TEXT', { source: 'web' })).toEqual({
        action: 'mode',
        mode: 'text',
        handled: true,
      });
    });

    it('rejects an unknown /mode argument with usage text', async () => {
      const result = await handleCommand('/mode loud', { source: 'tui' });
      expect(result.action).toBe('none');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Usage: /mode');
    });

    it('refuses /allow for untrusted senders', async () => {
      const result = await handleCommand('/allow example.com', { source: 'tui', trusted: false });
      expect(result.handled).toBe(true);
      expect(result.response?.toLowerCase()).toContain('trusted');
    });

    it('shows /allow usage when trusted but no domain is given', async () => {
      const result = await handleCommand('/allow', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Usage: /allow');
    });

    it('answers /exit with guidance rather than a fake exit action', async () => {
      const tui = await handleCommand('/exit', { source: 'tui' });
      expect(tui.handled).toBe(true);
      expect(tui.action).toBe('none');
      expect(tui.response).toContain('Ctrl+C');

      const telegram = await handleCommand('/exit', { source: 'telegram' });
      expect(telegram.action).toBe('none');
      expect(telegram.response).toBeTruthy();
    });

    it('should handle unknown commands', async () => {
      const result = await handleCommand('/unknown', { source: 'tui' });
      expect(result.handled).toBe(false);
      expect(result.response).toBeTruthy();
    });

    it('should format responses differently for TUI vs Telegram', async () => {
      const tuiResult = await handleCommand('/help', { source: 'tui' });
      const telegramResult = await handleCommand('/help', { source: 'telegram' });

      expect(tuiResult.response).toBeTruthy();
      expect(telegramResult.response).toBeTruthy();
    });

    // Characterizes the `source === 'telegram'` branching called out in
    // FINDINGS.md §2.8: today Telegram alone gets Markdown-styled command
    // output, and every other channel (whatsapp, tui, web) gets the same
    // copy with `*` stripped. Locking in the exact split before Phase 2's
    // `ChannelCapabilities.markdown` replaces this identity check.
    it('keeps literal * markdown markers only for telegram', async () => {
      const telegramHelp = await handleCommand('/help', { source: 'telegram' });
      const whatsappHelp = await handleCommand('/help', { source: 'whatsapp' });
      const tuiHelp = await handleCommand('/help', { source: 'tui' });

      expect(telegramHelp.response).toContain('*Available Commands:*');
      expect(whatsappHelp.response).not.toContain('*');
      expect(tuiHelp.response).not.toContain('*');
    });
  });

  describe('getAvailableCommands', () => {
    it('should return array of commands for TUI', () => {
      const commands = getAvailableCommands('tui');
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('should return array of commands for Telegram', () => {
      const commands = getAvailableCommands('telegram');
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('shares the core commands across interfaces', () => {
      const tuiCommands = getAvailableCommands('tui');
      const telegramCommands = getAvailableCommands('telegram');

      for (const cmd of ['/help', '/compact', '/clear', '/usage']) {
        expect(tuiCommands).toContain(cmd);
        expect(telegramCommands).toContain(cmd);
      }
    });

    it('scopes channel-specific commands to their channel', () => {
      expect(getAvailableCommands('tui')).toContain('/exit');
      expect(getAvailableCommands('telegram')).not.toContain('/exit');
    });

    it('includes aliases so completion resolves them', () => {
      expect(getAvailableCommands('tui')).toContain('/reset');
    });
  });

  describe('skill commands', () => {
    afterEach(() => setSkillsMode(originalSkillsMode));

    it('recognizes a skill as a command only in manual mode', () => {
      setSkillsMode('manual');
      expect(isCommand('/cat-fact tell me one')).toBe(true);
      expect(isCommand('/skill cat-fact')).toBe(true);

      setSkillsMode('auto');
      expect(isCommand('/cat-fact tell me one')).toBe(false);
    });

    it('hands the skill body and the remaining text back to the gateway', async () => {
      setSkillsMode('manual');

      const result = await handleCommand('/cat-fact tell me one', { source: 'tui', trusted: true });

      expect(result.action).toBe('skill');
      expect(result.handled).toBe(true);
      expect(result.skill).toEqual({
        name: 'cat-fact',
        content: 'Call catfact.ninja.',
        args: 'tell me one',
      });
    });

    it('resolves the explicit /skill form the same way', async () => {
      setSkillsMode('manual');

      const result = await handleCommand('/skill cat-fact tell me one', { source: 'tui', trusted: true });

      expect(result.action).toBe('skill');
      expect(result.skill).toMatchObject({ name: 'cat-fact', args: 'tell me one' });
    });

    it('refuses a skill command when learned skills are withheld from the sender', async () => {
      setSkillsMode('manual');

      const result = await handleCommand('/cat-fact', { source: 'tui', learnedSkillsEnabled: false });

      expect(result.action).toBe('none');
      expect(result.skill).toBeUndefined();
      expect(result.response).toContain('trusted senders');
    });

    it('allows a skill command on a channel that never sets the flag, matching auto mode', async () => {
      setSkillsMode('manual');

      // The web dashboard passes neither toolsEnabled nor learnedSkillsEnabled;
      // PromptRepository treats that as "skills on", so the command must too.
      const result = await handleCommand('/cat-fact', { source: 'web' });

      expect(result.action).toBe('skill');
      expect(result.skill).toMatchObject({ name: 'cat-fact' });
    });

    it('explains itself when /skill is used in auto mode', async () => {
      setSkillsMode('auto');

      const result = await handleCommand('/skill cat-fact', { source: 'tui', trusted: true });

      expect(result.action).toBe('none');
      expect(result.response).toContain('skills.mode');
    });

    it('lists the available skills when /skill names an unknown one', async () => {
      setSkillsMode('manual');

      const result = await handleCommand('/skill nope', { source: 'tui', trusted: true });

      expect(result.action).toBe('none');
      expect(result.response).toContain('No enabled skill named "nope"');
      expect(result.response).toContain('/cat-fact');
    });

    it('leaves an unknown slash message to the agent', async () => {
      setSkillsMode('manual');

      expect(isCommand('/nope')).toBe(false);
      const res = await handleCommand('/nope', { source: 'tui', trusted: true });
      expect(res.handled).toBe(false);
    });

    it('lists skills in /help and completion only in manual mode', async () => {
      setSkillsMode('manual');
      const helpManual = await handleCommand('/help', { source: 'tui' });
      expect(helpManual.response).toContain('/cat-fact');
      expect(getAvailableCommands('tui')).toContain('/cat-fact');
      expect(getAvailableCommands('tui')).toContain('/skill');

      setSkillsMode('auto');
      const helpAuto = await handleCommand('/help', { source: 'tui' });
      expect(helpAuto.response).not.toContain('/cat-fact');
      expect(getAvailableCommands('tui')).not.toContain('/cat-fact');
      expect(getAvailableCommands('tui')).not.toContain('/skill');
    });
  });

  describe('/skills', () => {
    afterEach(() => setSkillsMode(originalSkillsMode));

    it('lists every skill as a command in manual mode', async () => {
      setSkillsMode('manual');

      const result = await handleCommand('/skills', { source: 'tui' });

      expect(result.action).toBe('none');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Skills (2)');
      expect(result.response).toContain('/cat-fact');
      expect(result.response).toContain('Random cat facts');
      expect(result.response).toContain('/weather');
      expect(result.response).toContain('Forecasts');
      expect(result.response).toContain('/skill <name>');
      expect(result.response).toContain('/skills remote');
    });

    it('lists skills without slashes in auto mode, since they are already loaded', async () => {
      setSkillsMode('auto');

      const result = await handleCommand('/skills', { source: 'tui' });

      expect(result.response).toContain('Skills (2)');
      expect(result.response).toContain('cat-fact');
      expect(result.response).not.toContain('/cat-fact');
      expect(result.response).toContain('already part of my context');
      expect(result.response).toContain('/skills remote');
    });

    it('is recognised as a command in both modes', () => {
      setSkillsMode('manual');
      expect(isCommand('/skills')).toBe(true);

      setSkillsMode('auto');
      expect(isCommand('/skills')).toBe(true);
    });

    it('is offered for completion and listed in /help in both modes', async () => {
      setSkillsMode('manual');
      expect(getAvailableCommands('tui')).toContain('/skills');
      const helpManual = await handleCommand('/help', { source: 'tui' });
      expect(helpManual.response).toContain('/skills');

      setSkillsMode('auto');
      expect(getAvailableCommands('tui')).toContain('/skills');
      const helpAuto = await handleCommand('/help', { source: 'tui' });
      expect(helpAuto.response).toContain('/skills');
    });

    it('refuses when learned skills are withheld from the sender', async () => {
      setSkillsMode('manual');

      const result = await handleCommand('/skills', { source: 'tui', learnedSkillsEnabled: false });

      expect(result.response).toContain('trusted senders');
      expect(result.response).not.toContain('cat-fact');
    });

    it('says so when nothing is enabled', async () => {
      setSkillsMode('manual');
      getRecent.mockReturnValueOnce([]);

      const result = await handleCommand('/skills', { source: 'tui' });
      expect(result.response).toContain('No skills are enabled');
    });

    it('does not shadow the /skill loader', async () => {
      setSkillsMode('manual');

      const skillRes = await handleCommand('/skill cat-fact', { source: 'tui' });
      const skillsRes = await handleCommand('/skills', { source: 'tui' });
      expect(skillRes.action).toBe('skill');
      expect(skillsRes.action).toBe('none');
    });
  });

  describe('/tools', () => {
    it('is recognised as a command', () => {
      expect(isCommand('/tools')).toBe(true);
    });

    it('is offered for completion and listed in /help', async () => {
      expect(getAvailableCommands('tui')).toContain('/tools');
      const help = await handleCommand('/help', { source: 'tui' });
      expect(help.response).toContain('/tools');
    });

    it('dispatches to handleToolsCommand and lists tools', async () => {
      const result = await handleCommand('/tools', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('none');
      expect(result.response).toContain('Tools (2)');
      expect(result.response).toContain('curl_request');
      expect(result.response).toContain('search_engine');
    });

    it('rejects untrusted senders', async () => {
      const result = await handleCommand('/tools', { source: 'tui', trusted: false });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('trusted senders');
    });
  });

  describe('channels command', () => {
    it('is recognized as a command', () => {
      expect(isCommand('/channels')).toBe(true);
    });

    it('is offered for completion and listed in /help', async () => {
      expect(getAvailableCommands('tui')).toContain('/channels');
      const help = await handleCommand('/help', { source: 'tui' });
      expect(help.response).toContain('/channels');
    });

    it('dispatches to handleChannelsCommand', async () => {
      const result = await handleCommand('/channels', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('none');
      expect(result.response).toBeTruthy();
    });

    it('rejects untrusted senders', async () => {
      const result = await handleCommand('/channels', { source: 'tui', trusted: false });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('trusted senders');
    });
  });

  describe('CommandResult Structure', () => {
    it('should return proper CommandResult structure', async () => {
      const result = await handleCommand('/help', { source: 'tui' });
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('handled');
      expect(typeof result.handled).toBe('boolean');
    });

    it('should have correct action types', async () => {
      const exitResult = await handleCommand('/exit', { source: 'tui' });
      const clearResult = await handleCommand('/clear', { source: 'tui' });
      const resetResult = await handleCommand('/reset', { source: 'tui' });
      const helpResult = await handleCommand('/help', { source: 'tui' });

      expect(exitResult.action).toBe('none');
      expect(clearResult.action).toBe('clear');
      expect(resetResult.action).toBe('clear');
      expect(helpResult.action).toBe('none');
    });
  });
});
