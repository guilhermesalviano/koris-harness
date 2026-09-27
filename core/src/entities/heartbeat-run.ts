import { generateId } from "../utils/generate-id";

export class HeartbeatRun {
  public readonly id: string;
  public readonly runAt: Date;
  public readonly status: 'success' | 'error';
  public readonly errorMessage?: string;
  public readonly createdAt: Date;

  constructor(data: {
    id?: string;
    runAt: Date;
    status: 'success' | 'error';
    errorMessage?: string;
    createdAt?: Date;
  }) {
    this.id = data.id || generateId();
    this.runAt = data.runAt;
    this.status = data.status;
    this.errorMessage = data.errorMessage;
    this.createdAt = data.createdAt || new Date();
  }
}
