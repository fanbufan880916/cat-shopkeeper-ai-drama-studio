import { randomUUID } from "node:crypto";

export const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
export const now = () => new Date().toISOString();

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
