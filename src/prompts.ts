import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'sketchup-modeling-workflow',
    {
      title: 'SketchUp Modeling Workflow',
      description:
        'Recommended safe modeling workflow: verify target SketchUp instance, bind model context, edit with typed/batched tools, and visually inspect with view_capture.',
      argsSchema: {
        goal: z.string().optional().describe('Modeling objective to execute.'),
        unit: z
          .enum(['mm', 'cm', 'm', 'in', 'ft'])
          .optional()
          .describe('Preferred working length unit (default mm).'),
      },
    },
    ({ goal, unit }) => {
      const lines = [
        'Follow this SketchUp MCP modeling workflow:',
        '1. Call bridge_status first and confirm data.instance.profile_id, profile_name, and port match the intended SketchUp process.',
        '2. Read model_get_info (or sketchup://model/info) before editing so model_id and active_path are verified and bound.',
        '3. Inspect existing geometry and materials via entity_list / sketchup://materials; pass full path arrays for nested or shared components.',
        '4. Make changes with generic entity_* tools or batch_run (atomic undo). If a request times out (-32003), inspect bridge_status and the model before retrying—never blindly replay mutations.',
        '5. Frame the result with camera_set and visually verify with view_capture.',
      ];
      if (unit) {
        lines.push(
          `Preferred length unit: ${unit}. Pass unit: "${unit}" consistently across tools.`,
        );
      }
      if (goal) {
        lines.push(`Task goal: ${goal}`);
      }
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: lines.join('\n') },
          },
        ],
      };
    },
  );
}
