import { z } from 'zod';

export const finiteNumber = z.number().finite();
export const vec = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
export const positiveVec = z.tuple([
  finiteNumber.positive(),
  finiteNumber.positive(),
  finiteNumber.positive(),
]);
export const rgbColor = z.tuple([
  finiteNumber.min(0).max(255),
  finiteNumber.min(0).max(255),
  finiteNumber.min(0).max(255),
]);
export const unit = z.enum(['mm', 'cm', 'm', 'in', 'ft']).default('mm');
export const entityId = z.number().int().positive().safe();
export const entityRef = {
  entity_id: entityId.optional(),
  model_id: z.string().optional(),
  path: z.array(entityId).min(1).max(32).optional(),
};
export const modelRef = {
  model_id: z.string().min(1).optional(),
  active_path: z.array(entityId).max(32).optional(),
};
export const parentRef = z
  .object({
    entity_id: entityId.optional(),
    model_id: z.string().optional(),
    path: z.array(entityId).min(1).max(32).optional(),
  })
  .refine(
    (value) => value.entity_id !== undefined || value.path !== undefined,
    'Parent requires entity_id or path',
  );
export const outputFields = {
  path: z.string().min(1),
  overwrite: z.boolean().default(false),
};
export const entityName = z.string().min(1).max(255);

export interface ToolDef {
  name: string;
  title: string;
  method: string;
  description: string;
  schema: z.ZodRawShape;
  read?: boolean;
  destructive?: boolean;
}

export const toolOutputSchema = z.looseObject({
  success: z.literal(true),
  data: z.unknown(),
  warnings: z.array(z.string()),
  operation_id: z.union([z.string(), z.number()]).optional(),
  elapsed_ms: z.number().optional(),
  queue_ms: z.number().optional(),
});
