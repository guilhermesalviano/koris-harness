import { generateId } from "../utils/generate-id";
import { nowISO } from "../utils/date";
import { SessionKind } from "../types/session";

export interface SessionProps {
  id?: string;
  channel: string;
  peerId: string;
  kind?: SessionKind;
  startedAt?: string;
  endedAt?: string;
  messageCount?: number;
  metadata?: Record<string, unknown>;
}

export class Session {
  public readonly id: string;
  public readonly channel: string;
  public readonly peerId: string;
  public readonly kind: SessionKind;
  public readonly startedAt?: string;
  public readonly endedAt?: string;
  public readonly messageCount: number;
  public readonly metadata: Record<string, unknown>;

  constructor(props: SessionProps) {
    this.id = props.id ?? generateId();
    this.channel = props.channel;
    this.peerId = props.peerId;
    this.kind = props.kind ?? 'user';
    this.startedAt = props.startedAt ?? nowISO();
    this.endedAt = props.endedAt;
    this.messageCount = props.messageCount ?? 0;
    this.metadata = props.metadata ?? {};
  }
}
