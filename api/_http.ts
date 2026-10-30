// Minimal helpers for Vercel Node serverless functions (no extra dependency needed).
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Req = IncomingMessage & { body?: unknown };
export type Res = ServerResponse;

export function json(res: Res, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

/** Vercel parses JSON bodies into req.body; fall back to {} for anything else. */
export function body<T>(req: Req): T {
  const b = req.body;
  if (b && typeof b === 'object') return b as T;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b) as T;
    } catch {
      /* ignore */
    }
  }
  return {} as T;
}
