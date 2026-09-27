import { afterEach, describe, expect, it } from 'vitest';
import { activeRunsRegistry } from '../../../src/dashboard/active-runs';

function makeRun(id: string, sessionId: string, channel = 'web') {
  return { id, sessionId, question: 'q', startedAt: new Date().toISOString(), channel };
}

describe('ActiveRunRegistry', () => {
  afterEach(() => {
    for (const run of activeRunsRegistry.list()) activeRunsRegistry.finish(run.id);
  });

  it('aborts an attached controller by run id', () => {
    const ac = new AbortController();
    activeRunsRegistry.start(makeRun('r1', 's1'));
    activeRunsRegistry.attachController('r1', ac);

    expect(activeRunsRegistry.abort('r1')).toBe(true);
    expect(ac.signal.aborted).toBe(true);
  });

  it('returns false aborting a run with no controller or unknown id', () => {
    activeRunsRegistry.start(makeRun('r2', 's2'));
    expect(activeRunsRegistry.abort('r2')).toBe(false);
    expect(activeRunsRegistry.abort('missing')).toBe(false);
  });

  it('aborts the web run for a session via abortBySession', () => {
    const other = new AbortController();
    const target = new AbortController();
    activeRunsRegistry.start(makeRun('r3', 's3', 'telegram'));
    activeRunsRegistry.attachController('r3', other);
    activeRunsRegistry.start(makeRun('r4', 's3', 'web'));
    activeRunsRegistry.attachController('r4', target);

    expect(activeRunsRegistry.abortBySession('s3')).toBe(true);
    expect(target.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  it('returns false from abortBySession when no web run matches', () => {
    expect(activeRunsRegistry.abortBySession('nobody')).toBe(false);
  });

  it('drops the controller on finish so it cannot be aborted afterwards', () => {
    const ac = new AbortController();
    activeRunsRegistry.start(makeRun('r5', 's5'));
    activeRunsRegistry.attachController('r5', ac);

    activeRunsRegistry.finish('r5');

    expect(activeRunsRegistry.abort('r5')).toBe(false);
    expect(ac.signal.aborted).toBe(false);
  });
});
