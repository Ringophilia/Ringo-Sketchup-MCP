import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {fakeBridge, hello, respond, TOKEN} from './fixture.js';

const run = promisify(execFile);
const script = resolve('scripts/qa/multi-instance-demo.mjs');
const preview = Buffer.from('QA preview bytes');

async function fixture(t: TestContext, options: {wrongProfile?: boolean; sameProcess?: boolean} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ringo-multi-instance-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const targets: {id: string; requests: any[]}[] = [];
  for (const [index, id] of ['studio-west', 'client-42'].entries()) {
    const requests: any[] = [];
    const bridge = await fakeBridge((request, socket) => {
      if (hello(request, socket)) return;
      requests.push(request);
      const instance = {
        profile_id: options.wrongProfile && index === 1 ? 'unexpected-profile' : id,
        instance_id: `instance-${index}`,
        process_id: options.sameProcess ? 123 : 123 + index,
        port: bridge.port,
      };
      const result = request.method === 'bridge.status' ? {instance}
        : request.method === 'model.get_info' ? {instance, model_id: `model-${index}`}
        : request.method.startsWith('entity.create_') ? {entity: {persistent_id: 100 + requests.length}}
        : request.method === 'view.capture' ? {image_base64: preview.toString('base64')}
        : {ok: true};
      respond(socket, request, {success: true, data: result});
    });
    t.after(() => bridge.close());
    await writeFile(join(directory, `${id}.json`), JSON.stringify({host: '127.0.0.1', port: bridge.port, token: TOKEN, ruby_enabled: false}));
    targets.push({id, requests});
  }
  const args = [script, '--profiles-dir', directory, '--profile-a', targets[0].id, '--profile-b', targets[1].id, '--out', directory];
  return {directory, targets, args};
}

test('multi-instance QA requires explicit opt-in before connecting', async t => {
  const {targets, args} = await fixture(t);
  await assert.rejects(run(process.execPath, args), error => {
    assert.match((error as any).stdout, /allow-destructive/);
    return true;
  });
  assert.ok(targets.every(target => target.requests.length === 0));
});

for (const scenario of [{wrongProfile: true}, {sameProcess: true}]) {
  test(`multi-instance QA checks both targets before clearing: ${JSON.stringify(scenario)}`, async t => {
    const {targets, args} = await fixture(t, scenario);
    await assert.rejects(run(process.execPath, [...args, '--allow-destructive']));
    assert.ok(targets.every(target => target.requests.every(request => ['bridge.status', 'model.get_info'].includes(request.method))));
  });
}

test('multi-instance QA accepts arbitrary profiles and binds each fixture to its own model', async t => {
  const {directory, targets, args} = await fixture(t);
  const {stdout} = await run(process.execPath, [...args, '--allow-destructive']);
  const report = JSON.parse(stdout);
  assert.equal(report.success, true);
  assert.deepEqual(report.results.map((result: any) => result.profile_id), targets.map(target => target.id));
  for (const [index, target] of targets.entries()) {
    const mutations = target.requests.filter(request => !['bridge.status', 'model.get_info'].includes(request.method));
    assert.ok(mutations.some(request => request.method === 'scene.clear'));
    assert.ok(mutations.some(request => request.method === 'entity.create_box'));
    assert.ok(mutations.some(request => request.method === 'entity.create_cylinder'));
    assert.ok(mutations.every(request => request.params.model_id === `model-${index}`));
    assert.equal(mutations.find(request => request.method === 'model.save').params.path, join(directory, `${target.id}-multi-instance.skp`));
    assert.deepEqual(await readFile(join(directory, `${target.id}-multi-instance.png`)), preview);
  }
});
