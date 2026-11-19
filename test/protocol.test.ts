import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeMessage, MAX_FRAME, parseIncomingMessage, parseMessage } from '../src/protocol.js';

test('rejects malformed response envelopes and mismatched result/error', () => {
  for (const value of [
    [],
    null,
    { jsonrpc: '2.0', id: 1 },
    { jsonrpc: '2.0', id: 1, result: 1, error: {} },
    { jsonrpc: '2.0', result: 1 },
    { jsonrpc: '2.0', id: 1, error: { code: '1', message: 'bad' } },
  ])
    assert.throws(() => parseMessage(JSON.stringify(value)));
});
test('accepts false and null results; rejects oversized frames', () => {
  assert.equal(parseMessage('{"jsonrpc":"2.0","id":1,"result":false}').result, false);
  assert.equal(parseMessage('{"jsonrpc":"2.0","id":"a","result":null}').result, null);
  assert.throws(() => encodeMessage({ jsonrpc: '2.0', id: 1, result: 'a'.repeat(MAX_FRAME) }));
});
test('parses valid bridge.progress notifications and rejects malformed ones', () => {
  const valid = parseIncomingMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'bridge.progress',
      params: { request_id: 'req-1', progress: 2, total: 5, message: 'Step 2' },
    }),
  );
  assert.ok('method' in valid && valid.method === 'bridge.progress');
  assert.equal(valid.params.progress, 2);
  assert.equal(valid.params.total, 5);
  assert.equal(valid.params.message, 'Step 2');

  for (const invalid of [
    { jsonrpc: '2.0', method: 'bridge.progress', params: null },
    { jsonrpc: '2.0', method: 'bridge.progress', params: { request_id: true, progress: 1 } },
    { jsonrpc: '2.0', method: 'bridge.progress', params: { request_id: '1', progress: 'bad' } },
    {
      jsonrpc: '2.0',
      method: 'bridge.progress',
      params: { request_id: '1', progress: 1, total: '5' },
    },
    { jsonrpc: '2.0', id: 1, method: 'bridge.progress', params: { request_id: '1', progress: 1 } },
  ]) {
    assert.throws(() => parseIncomingMessage(JSON.stringify(invalid)));
  }
});
