import readline from 'readline';

export interface CommandContext {
  source: string;
  /** Whether the sender is trusted (tools enabled). Gates config-mutating commands. */
  trusted?: boolean;
  /**
   * Whether learned skills are available to this sender. Mirrors
   * `PromptRepository`: only an explicit `false` withholds them, so a channel
   * that never sets it (the web dashboard) keeps them.
   */
  learnedSkillsEnabled?: boolean;
  /** Stable id of the conversation origin (chat/user), surfaced by `/whoami`. */
  originId?: string;
  /** The current turn's session row id, needed by `/errand` to record the errand's origin. */
  sessionId?: string;
  session?: {
    messageCount: number;
    startTime: Date;
  };
  rl?: readline.Interface;
}

export interface CommandResult {
  response?: string;
  /**
   * A follow-up the MessageGateway must perform:
   * - `clear`   — rotate into a fresh, empty session
   * - `compact` — summarise this session into memory, then rotate
   * - `memory`  — reply with the summary carried into this session
   * - `skill`   — run the turn through the agent with `skill.content` injected
   * - `mode`    — set (or, when `mode` is unset, report) this conversation's reply mode
   * - `none`    — nothing beyond sending `response`
   */
  action?: 'clear' | 'compact' | 'memory' | 'skill' | 'mode' | 'none';
  /**
   * Set when `action === 'skill'`: the skill documentation to inject for this
   * one turn, and whatever the human typed after the skill name.
   */
  skill?: { name: string; content: string; args: string };
  /**
   * Set when `action === 'mode'` and the user asked to change the mode. Absent
   * means the user typed `/mode` alone and wants the current setting reported.
   */
  mode?: 'text' | 'voice';
  handled: boolean;
}