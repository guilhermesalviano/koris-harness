import { generateId } from "../utils/generate-id";
import { nowISO } from "../utils/date";
import { MessageRole, ImageAttachment } from "../types/messages";
import type { AgentId } from '../constants/agents';

export class Message {
  public readonly id: string;
  public readonly sessionId: string;
  public readonly role: MessageRole;
  public readonly content: string;
  public readonly senderAgentId?: AgentId;
  public readonly images?: ImageAttachment[];
  public readonly missingImages?: number;
  /** Set when this (assistant) message records a failed provider turn. */
  public readonly errorCode?: string;
  public readonly createdAt: string;

  constructor(data: {
    id?: string;
    sessionId: string;
    role: MessageRole;
    content: string;
    senderAgentId?: AgentId;
    images?: ImageAttachment[];
    missingImages?: number;
    errorCode?: string;
    createdAt?: string;
  }) {
    this.id = data.id || generateId();
    this.sessionId = data.sessionId;
    this.role = data.role;
    this.content = data.content;
    this.senderAgentId = data.senderAgentId;
    this.images = data.images;
    this.missingImages = data.missingImages;
    this.errorCode = data.errorCode;
    this.createdAt = data.createdAt || nowISO();
  }
}
