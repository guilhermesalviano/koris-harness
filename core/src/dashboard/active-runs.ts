export interface ActiveRun {
  id: string;
  sessionId: string;
  question: string;
  startedAt: string;
  channel: string;
}

class ActiveRunRegistry {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly controllers = new Map<string, AbortController>();

  start(run: ActiveRun): void {
    this.runs.set(run.id, run);
  }

  /** Associates an abort controller with a run so it can be cancelled later. */
  attachController(id: string, controller: AbortController): void {
    this.controllers.set(id, controller);
  }

  finish(id: string): void {
    this.runs.delete(id);
    this.controllers.delete(id);
  }

  /** Aborts a run by id. Returns whether a controller was found and aborted. */
  abort(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  /** Aborts the active web run for a session. Returns whether one was aborted. */
  abortBySession(sessionId: string): boolean {
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId && run.channel === 'web') {
        return this.abort(run.id);
      }
    }
    return false;
  }

  list(): ActiveRun[] {
    return Array.from(this.runs.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
}

const activeRunsRegistry = new ActiveRunRegistry();

export { activeRunsRegistry };
