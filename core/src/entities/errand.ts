import { generateId } from "../utils/generate-id";
import { nowISO } from "../utils/date";
import { ErrandDelivery, ErrandState } from "../types/errand";

export interface ErrandProps {
  id?: string;
  goal: string;
  state?: ErrandState;
  originSessionId: string;
  pendingMessage?: string;
  pendingDelivery?: ErrandDelivery;
  /** The Negotiator's closing message, held while the proposed result waits for the principal's confirmation. */
  closingReply?: string;
  notes?: string;
  result?: string;
  createdAt?: string;
  lastProgressAt?: string;
  closedAt?: string;
}

export class Errand {
  public readonly id: string;
  public readonly goal: string;
  public readonly state: ErrandState;
  public readonly originSessionId: string;
  public readonly pendingMessage?: string;
  public readonly pendingDelivery?: ErrandDelivery;
  public readonly closingReply?: string;
  public readonly notes?: string;
  public readonly result?: string;
  public readonly createdAt: string;
  public readonly lastProgressAt?: string;
  public readonly closedAt?: string;

  constructor(props: ErrandProps) {
    this.id = props.id ?? generateId();
    this.goal = props.goal;
    this.state = props.state ?? 'draft';
    this.originSessionId = props.originSessionId;
    this.pendingMessage = props.pendingMessage;
    this.pendingDelivery = props.pendingDelivery;
    this.closingReply = props.closingReply;
    this.notes = props.notes;
    this.result = props.result;
    this.createdAt = props.createdAt ?? nowISO();
    this.lastProgressAt = props.lastProgressAt;
    this.closedAt = props.closedAt;
  }
}
