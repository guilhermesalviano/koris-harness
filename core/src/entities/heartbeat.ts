import { generateId } from "../utils/generate-id";
import { BeatType } from "../types/beat";

export class Heartbeat {
  public readonly id: string;
  public readonly beat: string;
  public readonly type: BeatType;
  public readonly cronExpression: string;
  public channel?: string;
  public target?: string;
  public lastRun?: Date;
  public managed?: boolean;
  /** One-time beat: deleted after it fires instead of repeating on the next cron match (a pinned date would otherwise recur every year). */
  public runOnce?: boolean;
  public readonly createdAt: Date;

  constructor(data: {
    id?: string;
    beat: string;
    type: BeatType;
    cronExpression: string;
    channel?: string;
    target?: string;
    lastRun?: Date;
    managed?: boolean;
    runOnce?: boolean;
    createdAt?: Date;
  }) {
    this.id = data.id || generateId();
    this.beat = data.beat;
    this.type = data.type as BeatType;
    this.cronExpression = data.cronExpression;
    this.channel = data.channel;
    this.target = data.target;
    this.lastRun = data.lastRun;
    this.managed = data.managed;
    this.runOnce = data.runOnce;
    this.createdAt = data.createdAt || new Date();
  }
}
