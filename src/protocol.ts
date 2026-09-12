import { randomUUID } from 'node:crypto';
export const VERSION = '1.2.0';
export const PROTOCOL = 3;
export const MAX_FRAME = 4 * 1024 * 1024;
export type RpcId = string | number;
export type RpcRequest = { jsonrpc: '2.0'; id: RpcId; method: string; params: Record<string, unknown>; token?: string; deadline_ms?: number };
export type RpcResponse = { jsonrpc: '2.0'; id: RpcId | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };
export class RpcError extends Error {
  constructor(message: string, public code = -32000, public data?: unknown) { super(message); }
}
export const requestId = () => randomUUID();
export function encodeMessage(message: RpcRequest | RpcResponse): string {
  const text = JSON.stringify(message) + '\n';
  if (Buffer.byteLength(text) > MAX_FRAME) throw new RpcError('Message exceeds 4 MiB', -32600);
  return text;
}
export function parseMessage(line: string): RpcResponse {
  const v = JSON.parse(line);
  if (!v || Array.isArray(v) || v.jsonrpc !== '2.0' || !(typeof v.id === 'string' || Number.isSafeInteger(v.id) || v.id === null) || ('result' in v) === ('error' in v)) throw new RpcError('Invalid JSON-RPC response', -32600);
  if ('error' in v && (!v.error || !Number.isInteger(v.error.code) || typeof v.error.message !== 'string')) throw new RpcError('Invalid RPC error', -32600);
  return v;
}
