import { randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 13);
}