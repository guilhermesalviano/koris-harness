import { generateId } from "../utils/generate-id";
import { nowISO } from "../utils/date";
import { ChannelType } from "./channel";

export const OUTBOUND_MESSAGE_STATUSES = ['sent', 'failed'] as const;
export type OutboundMessageStatus = typeof OUTBOUND_MESSAGE_STATUSES[number];

export class OutboundMessage {
  public readonly id: string;
  public readonly channel: ChannelType;
  public readonly target: string;
  public readonly content: string;
  public readonly status: OutboundMessageStatus;
  public readonly errorMessage?: string;
  public readonly createdAt: string;
  public readonly sentAt?: string;

  constructor(data: {
    id?: string;
    channel: ChannelType;
    target: string;
    content: string;
    status: OutboundMessageStatus;
    errorMessage?: string;
    createdAt?: string;
    sentAt?: string;
  }) {
    this.id = data.id || generateId();
    this.channel = data.channel;
    this.target = data.target;
    this.content = data.content;
    this.status = data.status;
    this.errorMessage = data.errorMessage;
    this.createdAt = data.createdAt || nowISO();
    this.sentAt = data.sentAt;
  }
}