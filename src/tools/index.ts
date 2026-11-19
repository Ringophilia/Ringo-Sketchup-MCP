import { z } from 'zod';
import { RpcError } from '../protocol.js';
import { entityTools } from './entity.js';
import { ioTools } from './io.js';
import { modelTools } from './model.js';
import { sceneTools } from './scene.js';
import { entityName, modelRef, type ToolDef, toolOutputSchema } from './types.js';

export type { ToolDef };
export { toolOutputSchema };

export const toolDefs: ToolDef[] = [...modelTools, ...entityTools, ...sceneTools, ...ioTools];

export const batchMethods = new Set([
  'scene.clear',
  'entity.create_box',
  'entity.create_cylinder',
  'entity.create_mesh',
  'entity.extrude',
  'entity.transform',
  'entity.delete',
  'entity.set_material',
  'entity.update',
  'entity.duplicate',
  'entity.group',
  'entity.make_unique',
  'tags.set',
  'materials.set',
  'scene.set',
]);

export const referenceMethods = new Set([
  'entity.inspect',
  'entity.transform',
  'entity.update',
  'entity.delete',
  'entity.duplicate',
  'entity.make_unique',
  'entity.set_material',
]);

function failValidation(message: string): never {
  throw new RpcError(message, -32602);
}

function validateCylinderArgs(args: Record<string, unknown>): void {
  if (args.radius !== undefined && args.radius_mm !== undefined) {
    failValidation('Use either radius or deprecated radius_mm, not both');
  }
  if (args.height !== undefined && args.height_mm !== undefined) {
    failValidation('Use either height or deprecated height_mm, not both');
  }
  if (args.radius === undefined && args.radius_mm === undefined) {
    failValidation('Cylinder requires radius (or deprecated radius_mm)');
  }
  if (args.height === undefined && args.height_mm === undefined) {
    failValidation('Cylinder requires height (or deprecated height_mm)');
  }
}

export function validateArguments(method: string, args: Record<string, unknown>): void {
  if (referenceMethods.has(method) && args.entity_id === undefined && args.path === undefined) {
    failValidation('Entity reference requires entity_id or path');
  }
  if (
    args.entity_id !== undefined &&
    Array.isArray(args.path) &&
    args.path.at(-1) !== args.entity_id
  ) {
    failValidation('Entity ID must match the last ID in path');
  }
  if (args.parent !== undefined && args.parent_id !== undefined) {
    failValidation('Use either parent or parent_id');
  }
  if (method === 'entity.create_cylinder') {
    validateCylinderArgs(args);
  }
  if (method === 'entity.transform') {
    if ((args.axis === undefined) !== (args.angle_degrees === undefined)) {
      failValidation('axis and angle_degrees must be provided together');
    }
    if (Array.isArray(args.axis) && args.axis.every((v) => v === 0)) {
      failValidation('Rotation axis cannot be zero');
    }
    if (
      args.matrix &&
      ['translation', 'scale', 'axis', 'angle_degrees', 'rotation_degrees', 'pivot'].some(
        (key) => args[key] !== undefined,
      )
    ) {
      failValidation('matrix cannot be combined with scale, rotation, pivot or translation');
    }
    if (args.axis && args.rotation_degrees) {
      failValidation('Choose axis-angle or Euler rotation');
    }
  }
  if (method === 'camera.set') {
    if ((args.eye === undefined) !== (args.target === undefined)) {
      failValidation('eye and target must be provided together');
    }
    if (args.up && !args.eye) {
      failValidation('up requires eye and target');
    }
  }
  if (method === 'entity.create_mesh') {
    const vertices = args.vertices as unknown[];
    const faces = args.faces as number[][];
    if (
      faces.some(
        (face) =>
          face.some((index) => index >= vertices.length) || new Set(face).size !== face.length,
      )
    ) {
      failValidation('Mesh faces require distinct valid vertex indices');
    }
  }
  if (method === 'entity.extrude' && args.distance === 0) {
    failValidation('Extrusion distance cannot be zero');
  }
}

export function validateBatchArgs(input: unknown): Record<string, unknown> {
  const parsed = z
    .object({
      ...modelRef,
      commands: z
        .array(
          z.object({
            method: z.string(),
            params: z.record(z.string(), z.unknown()).default({}),
          }),
        )
        .min(1)
        .max(100),
      operation_name: entityName.default('MCP batch'),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) {
    throw new RpcError(
      `Invalid batch request: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      -32602,
      parsed.error.issues,
    );
  }
  const args = parsed.data;
  const commands = args.commands.map((command, index) => {
    const definition = toolDefs.find(
      (def) => def.method === command.method || def.name === command.method,
    );
    if (!definition || !batchMethods.has(definition.method)) {
      throw new RpcError(
        `Batch command ${index + 1} is not an allowed model mutation: ${command.method}`,
        -32602,
      );
    }
    const checked = z.object(definition.schema).strict().safeParse(command.params);
    if (!checked.success) {
      throw new RpcError(
        `Invalid parameters for batch command ${index + 1} (${command.method}): ${checked.error.issues.map((issue) => issue.message).join('; ')}`,
        -32602,
        checked.error.issues,
      );
    }
    validateArguments(definition.method, checked.data);
    const params = { ...checked.data } as Record<string, unknown>;
    if (args.model_id && params.model_id !== undefined && params.model_id !== args.model_id) {
      throw new RpcError(
        `Batch command ${index + 1} model_id does not match the batch model_id`,
        -32602,
      );
    }
    if (args.model_id && params.model_id === undefined) params.model_id = args.model_id;
    if (args.active_path && 'active_path' in definition.schema) {
      params.active_path ??= args.active_path;
    }
    return { method: definition.method, params };
  });
  return { ...args, commands };
}
