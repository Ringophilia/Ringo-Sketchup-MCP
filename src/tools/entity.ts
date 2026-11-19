import { z } from 'zod';
import {
  entityId,
  entityName,
  entityRef,
  finiteNumber,
  modelRef,
  parentRef,
  positiveVec,
  rgbColor,
  type ToolDef,
  unit,
  vec,
} from './types.js';

export const entityTools: ToolDef[] = [
  {
    name: 'entity_list',
    title: 'List Entities',
    method: 'entity.list',
    description:
      'Paginate entities with paths and world bounds. Recursive traversal distinguishes shared component instances. Use scan_limit for large models; total_exact reports whether total is complete.',
    schema: {
      ...modelRef,
      entity_id: entityId.optional(),
      path: z.array(entityId).min(1).max(32).optional(),
      type: entityName.optional(),
      name: entityName.optional(),
      tag: entityName.optional(),
      recursive: z.boolean().default(false),
      max_depth: z.number().int().min(0).max(32).default(16),
      limit: z.number().int().min(1).max(1000).default(100),
      offset: z.number().int().nonnegative().default(0),
      include_total: z.boolean().default(false),
      scan_limit: z.number().int().min(1000).max(1000000).default(100000),
      unit,
    },
    read: true,
  },
  {
    name: 'entity_inspect',
    title: 'Inspect Entity',
    method: 'entity.inspect',
    description:
      'Inspect persistent ID, instance path, world bounds, solid status and transform. Translation entries in matrices use the requested unit.',
    schema: { ...entityRef, unit },
    read: true,
  },
  {
    name: 'selection_get',
    title: 'Get Selection',
    method: 'selection.get',
    description:
      'Paginate currently selected entities with total count, limit, offset and next_offset.',
    schema: {
      limit: z.number().int().min(1).max(1000).default(100),
      offset: z.number().int().nonnegative().default(0),
      unit,
    },
    read: true,
  },
  {
    name: 'selection_set',
    title: 'Set Selection',
    method: 'selection.set',
    description: 'Set selection using existing entity IDs; empty list clears selection.',
    schema: { ...modelRef, entity_ids: z.array(entityId).max(1000) },
  },
  {
    name: 'entity_create_box',
    title: 'Create Box',
    method: 'entity.create_box',
    description: 'Create a box toward positive Z with an undo transaction. Default unit is mm.',
    schema: {
      ...modelRef,
      size: positiveVec,
      origin: vec.optional(),
      unit,
      name: entityName.optional(),
      tag: entityName.optional(),
      parent_id: entityId.optional(),
      parent: parentRef.optional(),
    },
  },
  {
    name: 'entity_create_cylinder',
    title: 'Create Cylinder',
    method: 'entity.create_cylinder',
    description:
      'Create a positive Z cylinder using radius and height in the requested unit (default mm), with optional smooth sides. Deprecated radius_mm/height_mm remain supported for compatibility.',
    schema: {
      ...modelRef,
      radius: finiteNumber
        .positive()
        .optional()
        .describe('Cylinder radius in the requested unit (default mm).'),
      height: finiteNumber
        .positive()
        .optional()
        .describe('Cylinder height in the requested unit (default mm).'),
      radius_mm: finiteNumber
        .positive()
        .optional()
        .describe('Deprecated alias for radius in millimeters; cannot be combined with radius.'),
      height_mm: finiteNumber
        .positive()
        .optional()
        .describe('Deprecated alias for height in millimeters; cannot be combined with height.'),
      origin: vec.optional(),
      unit,
      segments: z.number().int().min(8).max(256).default(48),
      smooth: z.boolean().default(false),
      name: entityName.optional(),
      tag: entityName.optional(),
      parent_id: entityId.optional(),
      parent: parentRef.optional(),
    },
  },
  {
    name: 'entity_create_mesh',
    title: 'Create Mesh',
    method: 'entity.create_mesh',
    description:
      'Create arbitrary grouped geometry from vertices and zero-based face indices. Triangulate nonplanar faces. Supports smooth shading.',
    schema: {
      ...modelRef,
      vertices: z.array(vec).min(3).max(50000),
      faces: z.array(z.array(z.number().int().nonnegative()).min(3).max(256)).min(1).max(100000),
      smooth: z.boolean().default(true),
      origin: vec.optional(),
      unit,
      name: entityName.optional(),
      tag: entityName.optional(),
      parent_id: entityId.optional(),
      parent: parentRef.optional(),
    },
  },
  {
    name: 'entity_extrude',
    title: 'Extrude Polygon',
    method: 'entity.extrude',
    description:
      'Extrude a planar polygon along its normal. XY polygons are oriented toward positive Z.',
    schema: {
      ...modelRef,
      points: z.array(vec).min(3).max(1000),
      distance: finiteNumber,
      origin: vec.optional(),
      unit,
      name: entityName.optional(),
      tag: entityName.optional(),
      parent_id: entityId.optional(),
      parent: parentRef.optional(),
    },
  },
  {
    name: 'entity_transform',
    title: 'Transform Entity',
    method: 'entity.transform',
    description:
      'Transform a group/instance in its parent coordinates. Scale, rotate, then translate. Matrix replaces transform; column major with translation in unit. Axis-angle preferred; legacy Euler X,Y,Z supported.',
    schema: {
      ...entityRef,
      unit,
      translation: vec.optional(),
      rotation_degrees: vec.optional(),
      axis: vec.optional(),
      angle_degrees: finiteNumber.optional(),
      pivot: vec.optional(),
      scale: positiveVec.optional(),
      matrix: z.array(finiteNumber).length(16).optional(),
    },
  },
  {
    name: 'entity_update',
    title: 'Update Entity',
    method: 'entity.update',
    description: 'Set entity name, tag, visibility or lock state.',
    schema: {
      ...entityRef,
      name: entityName.optional(),
      tag: entityName.optional(),
      hidden: z.boolean().optional(),
      locked: z.boolean().optional(),
    },
  },
  {
    name: 'entity_delete',
    title: 'Delete Entity',
    method: 'entity.delete',
    description: 'Delete an existing entity in an undoable operation.',
    schema: entityRef,
    destructive: true,
  },
  {
    name: 'entity_duplicate',
    title: 'Duplicate Entity',
    method: 'entity.duplicate',
    description: 'Copy a group or component; offset in the parent coordinate system.',
    schema: {
      ...entityRef,
      name: entityName.optional(),
      translation: vec.default([0, 0, 0]),
      unit,
    },
  },
  {
    name: 'entity_group',
    title: 'Group Entities',
    method: 'entity.group',
    description: 'Group existing entities in the current edit context.',
    schema: {
      ...modelRef,
      entity_ids: z.array(entityId).min(1).max(1000),
      name: entityName.optional(),
    },
  },
  {
    name: 'entity_make_unique',
    title: 'Make Entity Unique',
    method: 'entity.make_unique',
    description: 'Make a component instance or group independent of shared geometry.',
    schema: entityRef,
  },
  {
    name: 'entity_set_material',
    title: 'Assign Entity Material',
    method: 'entity.set_material',
    description:
      'Assign material to an instance or its direct faces. Faces scope makes instances unique first.',
    schema: {
      ...entityRef,
      material: entityName,
      color: rgbColor.optional(),
      scope: z.enum(['instance', 'faces']).default('instance'),
    },
  },
];
