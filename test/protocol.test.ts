import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage,encodeMessage,MAX_FRAME} from '../src/protocol.js';
test('rejects malformed response envelopes and mismatched result/error',()=>{
  for(const value of [[],null,{jsonrpc:'2.0',id:1},{jsonrpc:'2.0',id:1,result:1,error:{}},{jsonrpc:'2.0',result:1},{jsonrpc:'2.0',id:1,error:{code:'1',message:'bad'}}]) assert.throws(()=>parseMessage(JSON.stringify(value)));
});
test('accepts false and null results; rejects oversized frames',()=>{
  assert.equal(parseMessage('{"jsonrpc":"2.0","id":1,"result":false}').result,false);
  assert.equal(parseMessage('{"jsonrpc":"2.0","id":"a","result":null}').result,null);
  assert.throws(()=>encodeMessage({jsonrpc:'2.0',id:1,result:'a'.repeat(MAX_FRAME)}));
});
