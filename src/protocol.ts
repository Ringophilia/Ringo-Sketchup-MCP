import { randomUUID } from 'node:crypto';
export const VERSION = '2.0.0';
export const PROTOCOL = 3;
export const MAX_FRAME = 4 * 1024 * 1024;
export type RpcId = string | number;
export type RpcRequest = {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params: Record<string, unknown>;
  token?: string;
  deadline_ms?: number;
};
export type RpcResponse = {
  jsonrpc: '2.0';
  id: RpcId | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};
export type RpcProgressNotification = {
  jsonrpc: '2.0';
  method: 'bridge.progress';
  params: {
    request_id: RpcId;
    progress: number;
    total?: number;
    message?: string;
  };
};
export class RpcError extends Error {
  constructor(
    message: string,
    public code = -32000,
    public data?: unknown,
  ) {
    super(message);
  }
}
export const requestId = () => randomUUID();
export function encodeMessage(message: RpcRequest | RpcResponse): string {
  const text = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(text) > MAX_FRAME) throw new RpcError('Message exceeds 4 MiB', -32600);
  return text;
}
function isRpcId(value: unknown): value is RpcId {
  return typeof value === 'string' || Number.isSafeInteger(value);
}
export function parseMessage(line: string): RpcResponse {
  const v = JSON.parse(line);
  if (
    !v ||
    Array.isArray(v) ||
    v.jsonrpc !== '2.0' ||
    !(isRpcId(v.id) || v.id === null) ||
    'result' in v === 'error' in v
  )
    throw new RpcError('Invalid JSON-RPC response', -32600);
  if (
    'error' in v &&
    (!v.error || !Number.isInteger(v.error.code) || typeof v.error.message !== 'string')
  )
    throw new RpcError('Invalid RPC error', -32600);
  return v;
}
export function parseIncomingMessage(line: string): RpcResponse | RpcProgressNotification {
  const v = JSON.parse(line);
  if (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    v.jsonrpc === '2.0' &&
    v.method === 'bridge.progress' &&
    !('id' in v)
  ) {
    const p = v.params;
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      !isRpcId(p.request_id) ||
      typeof p.progress !== 'number' ||
      !Number.isFinite(p.progress) ||
      (p.total !== undefined && (typeof p.total !== 'number' || !Number.isFinite(p.total))) ||
      (p.message !== undefined && typeof p.message !== 'string')
    ) {
      throw new RpcError('Invalid JSON-RPC progress notification', -32600);
    }
    return v as RpcProgressNotification;
  }
  return parseMessage(line);
}
