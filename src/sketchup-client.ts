import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { readConfig } from './config.js';
import { encodeMessage, parseMessage, requestId, RpcError, MAX_FRAME, PROTOCOL } from './protocol.js';
export type ClientOptions = {host?: string; port?: number; token?: string; timeoutMs?: number; connectTimeoutMs?: number};
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; detach: () => void };
export class SketchupClient {
  private socket?: net.Socket;
  private connecting?: Promise<void>;
  private pending = new Map<string, Pending>();
  private options: Required<ClientOptions>;
  capabilities: Record<string, unknown> = {};
  constructor(options: ClientOptions = {}) { this.options = { ...readConfig(), connectTimeoutMs: 5000, ...options }; }
  async call(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    await this.connect();
    signal?.throwIfAborted();
    return this.send(method, params, signal);
  }
  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.socket && !this.socket.destroyed) return;
    if (this.options.token.length < 32) throw new RpcError('Bridge token missing. Run the installer, or configure SKETCHUP_TOKEN.', -32001);
    this.connecting = (async () => {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({host: this.options.host, port: this.options.port});
        this.socket = socket;
        let buffer = ''; const decoder = new StringDecoder('utf8');
        const timer = setTimeout(() => { socket.destroy(); reject(new RpcError('Connection timed out. Open SketchUp and start the extension.', -32002)); }, this.options.connectTimeoutMs);
        socket.setNoDelay(true);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.on('error', (e) => { clearTimeout(timer); reject(new RpcError(e.message, -32002)); });
        socket.on('close', () => {
          clearTimeout(timer);
          reject(new RpcError('Connection closed during handshake', -32002));
          if (this.socket === socket) { this.socket = undefined; this.failAll(new RpcError('Connection lost; submitted operations may have executed. Do not replay mutations automatically.', -32002)); }
        });
        socket.on('data', (bytes: Buffer) => {
          if (this.socket !== socket) return;
          buffer += decoder.write(bytes);
          try {
            while (buffer.includes('\n')) {
              const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
              if (Buffer.byteLength(line) > MAX_FRAME) throw new Error('Oversized response');
              const response = parseMessage(line); const p = this.pending.get(String(response.id));
              if (p) { this.finish(String(response.id)); response.error ? p.reject(new RpcError(response.error.message, response.error.code, response.error.data)) : p.resolve(response.result); }
            }
            if (Buffer.byteLength(buffer) > MAX_FRAME) throw new Error('Oversized unfinished response');
          } catch (e) { this.failAll(new RpcError('Protocol error: ' + (e as Error).message, -32600)); socket.destroy(); }
        });
      });
      const hello = await this.send('bridge.hello', {protocol: PROTOCOL}) as {protocol: number; supported_protocols?: number[]; capabilities: Record<string,unknown>};
      if (hello.protocol !== PROTOCOL && !hello.supported_protocols?.includes(PROTOCOL)) throw new RpcError('Incompatible protocol major; update either side. Minor versions are negotiated by capability.', -32004);
      this.capabilities = hello.capabilities;
    })().catch((e) => { this.socket?.destroy(); throw e; }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private send(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = requestId();
    const wire = encodeMessage({jsonrpc: '2.0', id, method, params, token: this.options.token, deadline_ms: Date.now() + this.options.timeoutMs});
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.finish(id);
        if (this.socket && !this.socket.destroyed) this.socket.write(encodeMessage({jsonrpc: '2.0', id: requestId(), method: 'bridge.cancel', token: this.options.token, params: {request_id: id}}));
        reject(new RpcError('Cancelled or timed out; inspect bridge status before retrying a mutation.', -32003, {request_id: id, outcome: 'unknown'}));
      };
      const timer = setTimeout(cancel, this.options.timeoutMs);
      signal?.addEventListener('abort', cancel, {once: true});
      this.pending.set(id, {resolve, reject, timer, detach: () => signal?.removeEventListener('abort', cancel)});
      if (signal?.aborted) { cancel(); return; }
      this.socket!.write(wire, (e) => { if (e && this.pending.has(id)) { this.finish(id); reject(new RpcError(e.message, -32002)); } });
    });
  }
  private finish(id: string): void { const p = this.pending.get(id); if (p) { clearTimeout(p.timer); p.detach(); this.pending.delete(id); } }
  private failAll(error: Error): void { for (const [id,p] of this.pending) { this.finish(id); p.reject(error); } }
  async close(): Promise<void> { this.failAll(new RpcError('Client closed', -32002)); const socket = this.socket; this.socket = undefined; socket?.destroy(); }
}
