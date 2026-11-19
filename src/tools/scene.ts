import { z } from 'zod';
import {
  entityId,
  entityName,
  finiteNumber,
  modelRef,
  rgbColor,
  type ToolDef,
  unit,
  vec,
} from './types.js';

export const sceneTools: ToolDef[] = [
  {
    name: 'materials_list',
    title: 'List Materials',
    method: 'materials.list',
    description: 'List material color, alpha and texture status with optional pagination.',
    schema: {
      limit: z.number().int().min(1).max(2000).default(500),
      offset: z.number().int().nonnegative().default(0),
    },
    read: true,
  },
  {
    name: 'materials_set',
    title: 'Set Material',
    method: 'materials.set',
    description:
      'Create/update material. Optional PBR roughness gracefully falls back on older SketchUp.',
    schema: {
      ...modelRef,
      name: entityName,
      color: rgbColor.optional(),
      alpha: finiteNumber.min(0).max(1).optional(),
      texture: z.string().optional(),
      roughness: finiteNumber.min(0).max(1).optional(),
    },
  },
  {
    name: 'tags_list',
    title: 'List Tags',
    method: 'tags.list',
    description: 'List tags and visibility with optional pagination.',
    schema: {
      limit: z.number().int().min(1).max(2000).default(500),
      offset: z.number().int().nonnegative().default(0),
    },
    read: true,
  },
  {
    name: 'tags_set',
    title: 'Set Tag',
    method: 'tags.set',
    description: 'Create a tag or set its visibility.',
    schema: { ...modelRef, name: entityName, visible: z.boolean().optional() },
  },
  {
    name: 'scenes_list',
    title: 'List Scenes',
    method: 'scene.list',
    description: 'List saved SketchUp scenes.',
    schema: {},
    read: true,
  },
  {
    name: 'scenes_set',
    title: 'Save or Select Scene',
    method: 'scene.set',
    description: 'Save/update the current view as a scene, or select an existing scene.',
    schema: {
      ...modelRef,
      name: entityName,
      action: z.enum(['save', 'select']).default('save'),
    },
  },
  {
    name: 'camera_get',
    title: 'Get Camera',
    method: 'camera.get',
    description: 'Read camera eye, target and up vector.',
    schema: {},
    read: true,
  },
  {
    name: 'camera_set',
    title: 'Set Camera',
    method: 'camera.set',
    description: 'Set camera and optionally frame an entity or the whole model.',
    schema: {
      ...modelRef,
      eye: vec.optional(),
      target: vec.optional(),
      up: vec.optional(),
      perspective: z.boolean().optional(),
      height: finiteNumber.positive().optional(),
      fov: finiteNumber.min(1).max(120).optional(),
      entity_id: entityId.optional(),
      path: z.array(entityId).min(1).max(32).optional(),
      zoom_extents: z.boolean().optional(),
      unit,
    },
  },
];
