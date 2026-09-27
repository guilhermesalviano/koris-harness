import { generateId } from "../utils/generate-id";
import { nowISO } from "../utils/date";

export const CHANNEL_TYPES = ['telegram', 'whatsapp'] as const;
export type ChannelType = typeof CHANNEL_TYPES[number];

export class Channel {
  public readonly id: string;
  public readonly channel: ChannelType;
  public readonly target: string;
  public readonly isPrincipal: boolean;
  public readonly createdAt: string;
  public readonly updatedAt: string;

  constructor(data: {
    id?: string;
    channel: ChannelType;
    target: string;
    isPrincipal?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }) {
    this.id = data.id || generateId();
    this.channel = data.channel;
    this.target = data.target;
    this.isPrincipal = data.isPrincipal ?? false;
    this.createdAt = data.createdAt || nowISO();
    this.updatedAt = data.updatedAt || nowISO();
  }
}
