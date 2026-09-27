import { generateId } from "../utils/generate-id";
import { MemoryType } from "../types/memory";

export class Memory {
  public id: string;
  public sessionId: string;
  public source: string;
  public type: MemoryType;
  public content: string;
  public embedding?: number[];
  public tags?: string;
  public importance?: number;
  public createdAt: Date;

  constructor(data: {
    id?: string;
    sessionId: string;
    source: string;
    type: MemoryType;
    content: string;
    embedding?: number[];
    tags?: string;
    importance?: number;
    createdAt?: Date;
  }) {
    this.id = data.id || generateId();
    this.sessionId = data.sessionId;
    this.source = data.source;
    this.type = data.type;
    this.content = data.content;
    this.embedding = data.embedding;
    this.tags = data.tags;
    this.importance = data.importance;
    this.createdAt = data.createdAt || new Date();
  }
}