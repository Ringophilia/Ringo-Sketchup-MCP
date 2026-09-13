import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {SketchupClient} from '../../dist/sketchup-client.js';
import {configRootPath, readJson, validateConfig, validateProfileId} from '../install.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaultProfilesDir() {
  return join(configRootPath(), 'profiles');
}

function usage() {
  console.log(`Usage: npm run test:multi-instance -- --allow-destructive [options]

This QA fixture clears and saves two open, disposable SketchUp models.
Options:
  --profile-a ID       First configured profile (default: project-a)
  --profile-b ID       Second configured profile (default: project-b)
  --profiles-dir PATH  Profile registry directory
  --out PATH           Output directory (default: artifacts/)
  --allow-destructive  Required acknowledgement before models are cleared
`);
}

function requireExpectedProfile(info, expected, source) {
  const actual = info?.instance?.profile_id;
  if (actual !== expected) throw Error(`${source} connected to profile ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}. Select the correct profile in SketchUp before running this QA fixture.`);
}

async function makeClient(profileId, profilesDir) {
  validateProfileId(profileId);
  const configPath = join(profilesDir, `${profileId}.json`);
  const config = validateConfig(await readJson(configPath));
  return {
    profileId,
    client: new SketchupClient({
      host: config.host,
      port: config.port,
      token: config.token,
      timeoutMs: 120000,
      connectTimeoutMs: 5000,
    }),
  };
}

async function call(target, method, params = {}) {
  const raw = await target.client.call(method, {...params, model_id: params.model_id ?? target.modelId});
  if (raw?.success === false) throw Error(`${target.profileId}/${method}: ${JSON.stringify(raw)}`);
  return raw?.data ?? raw;
}

async function inspectTarget(target) {
  const bridge = await call(target, 'bridge.status');
  requireExpectedProfile(bridge, target.profileId, 'bridge.status');
  const info = await call(target, 'model.get_info');
  requireExpectedProfile(info, target.profileId, 'model.get_info');
  if (!info.model_id || !info.instance.instance_id || !info.instance.process_id || !info.instance.port) throw Error('Missing model or instance identity.');
  if (bridge.instance.instance_id !== info.instance.instance_id) throw Error('SketchUp instance changed during preflight.');
  target.modelId = info.model_id;
  target.info = info;
}

async function createFixture(target, variant, artifacts) {
    const info = target.info;
    await call(target, 'scene.clear');
    const material = `QA ${variant.label} Material`;
    await call(target, 'materials.set', {name: material, color: variant.color, alpha: 1});
    const base = await call(target, 'entity.create_box', {
      size: variant.baseSize,
      origin: [0, 0, 0],
      unit: 'mm',
      name: `QA ${variant.label} base`,
    });
    await call(target, 'entity.set_material', {entity_id: base.entity.persistent_id, material, scope: 'faces'});
    const column = await call(target, 'entity.create_cylinder', {
      radius_mm: variant.radius,
      height_mm: variant.height,
      origin: [variant.baseSize[0] / 2, variant.baseSize[1] / 2, variant.baseSize[2]],
      segments: 32,
      smooth: true,
      name: `QA ${variant.label} column`,
    });
    await call(target, 'entity.set_material', {entity_id: column.entity.persistent_id, material, scope: 'faces'});
    await call(target, 'camera.set', {
      eye: [420, -540, 340],
      target: [variant.baseSize[0] / 2, variant.baseSize[1] / 2, variant.height / 2],
      up: [0, 0, 1],
      perspective: true,
      fov: 42,
    });

    const preview = await call(target, 'view.capture', {width: 900, height: 700});
    await mkdir(artifacts, {recursive: true});
    const stem = `${target.profileId}-multi-instance`;
    const imagePath = join(artifacts, `${stem}.png`);
    const modelPath = join(artifacts, `${stem}.skp`);
    const imageBytes = Buffer.from(preview.image_base64, 'base64');
    await writeFile(imagePath, imageBytes);
    const saved = await call(target, 'model.save', {path: modelPath, overwrite: true});
    return {
      profile_id: target.profileId,
      instance: info.instance,
      model_id: target.modelId,
      entity_ids: [base.entity.persistent_id, column.entity.persistent_id],
      image_path: imagePath,
      image_bytes: imageBytes.length,
      save: saved,
    };
}

const {values} = parseArgs({
  options: {
    'allow-destructive': {type: 'boolean'},
    help: {type: 'boolean'},
    'profile-a': {type: 'string', default: 'project-a'},
    'profile-b': {type: 'string', default: 'project-b'},
    'profiles-dir': {type: 'string'},
    out: {type: 'string'},
  },
});

if (values.help) {
  usage();
} else if (!values['allow-destructive']) {
  usage();
  process.exitCode = 1;
} else if (values['profile-a'] === values['profile-b']) {
  throw Error('--profile-a and --profile-b must identify different profiles.');
} else {
  const profilesDir = values['profiles-dir'] ? resolve(values['profiles-dir']) : defaultProfilesDir();
  const artifacts = resolve(values.out ?? join(root, 'artifacts'));
  const targets = [];
  try {
    for (const id of [values['profile-a'], values['profile-b']]) {
      const target = await makeClient(id, profilesDir);
      targets.push(target);
      await inspectTarget(target);
    }
    const [a, b] = targets;
    if (a.modelId === b.modelId || ['instance_id', 'process_id', 'port'].some(key => a.info.instance[key] === b.info.instance[key])) {
      throw Error('The two targets must have different SketchUp processes, ports, instances, and model sessions.');
    }
    // Both targets pass preflight before either disposable model is cleared.
    const settled = await Promise.allSettled([
      createFixture(a, {label: 'Project A', color: [42, 122, 185], baseSize: [240, 150, 32], radius: 28, height: 140}, artifacts),
      createFixture(b, {label: 'Project B', color: [168, 84, 50], baseSize: [180, 220, 24], radius: 36, height: 120}, artifacts),
    ]);
    const failures = settled.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Multi-instance QA failed; inspect both models before retrying.');
    console.log(JSON.stringify({success: true, profiles_dir: profilesDir, results: settled.map(result => result.value)}, null, 2));
  } finally {
    await Promise.all(targets.map(target => target.client.close()));
  }
}
