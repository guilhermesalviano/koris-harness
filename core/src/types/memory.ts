export type MemoryType = 'summary' | 'fact' | 'lesson' | 'reminder';

export type Memory = {
  id: string;
  sessionId: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  tags?: string;
  importance?: number;
  createdAt: Date;
};
