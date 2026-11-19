import { z } from 'zod';
import { entityName, modelRef, outputFields, type ToolDef } from './types.js';

export const ioTools: ToolDef[] = [
  {
    name: 'model_save',
    title: 'Save Model',
    method: 'model.save',
    description: 'Save SKP to an absolute path. Explicit overwrite flag protects existing files.',
    schema: { ...modelRef, ...outputFields },
  },
  {
    name: 'model_export',
    title: 'Export Model',
    method: 'model.export',
    description:
      'Export through the installed SketchUp exporter selected by file extension. Availability depends on the host edition/version.',
    schema: {
      ...modelRef,
      ...outputFields,
      options: z.record(z.string(), z.unknown()).optional(),
    },
  },
  {
    name: 'view_capture',
    title: 'Capture View',
    method: 'view.capture',
    description:
      'See the current SketchUp view directly as an image. No output path required. Use after modeling to visually verify the result.',
    schema: {
      ...modelRef,
      width: z.number().int().min(64).max(2048).default(1280),
      height: z.number().int().min(64).max(2048).default(960),
      transparent: z.boolean().default(false),
    },
    read: true,
  },
  {
    name: 'view_export',
    title: 'Export View Image',
    method: 'view.export',
    description: 'Export PNG/JPG from SketchUp for visual verification.',
    schema: {
      ...modelRef,
      ...outputFields,
      width: z.number().int().min(64).max(4096).default(1600),
      height: z.number().int().min(64).max(4096).default(1200),
      transparent: z.boolean().default(false),
    },
  },
  {
    name: 'batch_run',
    title: 'Run Batch Mutations',
    method: 'batch.run',
    description:
      'Run 1–100 typed model mutations in a single atomic undo operation. Ruby, save, undo, and nested batches excluded.',
    schema: {
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
    },
  },
  {
    name: 'sketchup_run_ruby',
    title: 'Run Ruby Script',
    method: 'ruby.eval',
    description:
      'Execute trusted SketchUp Ruby on the UI thread in an isolated evaluation context (local variables and helper methods do not persist across calls). Requires ruby_enabled. Default transaction rolls back failures; do not start nested SketchUp operations. Captures stdout. Running Ruby cannot be forcibly cancelled safely.',
    schema: {
      ...modelRef,
      code: z
        .string()
        .min(1)
        .refine((s) => Buffer.byteLength(s) <= 200000, 'Code exceeds 200 KB'),
      transaction: z.boolean().default(true),
      operation_name: entityName.default('MCP Ruby'),
    },
    destructive: true,
  },
];
