import { z } from 'zod';
import { modelRef, type ToolDef } from './types.js';

export const modelTools: ToolDef[] = [
  {
    name: 'bridge_status',
    title: 'Bridge Status',
    method: 'bridge.status',
    description:
      'Inspect connection, selected SketchUp profile/instance, capabilities, queue and recent request states. Runtime permissions and optional APIs are discovered here.',
    schema: {},
    read: true,
  },
  {
    name: 'model_get_info',
    title: 'Get Model Info',
    method: 'model.get_info',
    description: 'Get model session ID, path, units, edit context and runtime capabilities.',
    schema: {},
    read: true,
  },
  {
    name: 'model_stats',
    title: 'Model Statistics',
    method: 'model.stats',
    description:
      'Count entities through instance paths, materials, tags and scenes. Results are bounded by max_entities.',
    schema: {
      ...modelRef,
      max_entities: z.number().int().min(1000).max(1000000).default(100000),
    },
    read: true,
  },
  {
    name: 'model_snapshot',
    title: 'Capture Model Snapshot',
    method: 'model.snapshot',
    description: 'Capture bounded entity/path metadata for subsequent changes comparison.',
    schema: modelRef,
    read: true,
  },
  {
    name: 'model_diff',
    title: 'Diff Model Snapshot',
    method: 'model.diff',
    description:
      'Compare entity metadata with a snapshot; reports bounded added, removed and changed lists (per-category limit), total counts and truncated flag.',
    schema: {
      ...modelRef,
      snapshot_id: z.string(),
      limit: z.number().int().min(1).max(5000).default(500),
    },
    read: true,
  },
  {
    name: 'model_undo',
    title: 'Undo Operation',
    method: 'model.undo',
    description: 'Undo the most recent SketchUp operation.',
    schema: modelRef,
    destructive: true,
  },
  {
    name: 'model_redo',
    title: 'Redo Operation',
    method: 'model.redo',
    description: 'Redo when supported by this SketchUp version.',
    schema: modelRef,
    destructive: true,
  },
  {
    name: 'scene_clear',
    title: 'Clear Model',
    method: 'scene.clear',
    description: 'Erase all model entities in one undoable operation. Requires root edit context.',
    schema: modelRef,
    destructive: true,
  },
];
