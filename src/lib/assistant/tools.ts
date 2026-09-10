// Anthropic tool-use schemas for the Dashboard assistant. Kept separate
// from the route handler so the 4 supported actions are easy to review and
// extend on their own. Each tool's `input_schema` follows Anthropic's
// tool-calling JSON Schema format: https://docs.anthropic.com/en/docs/tool-use

export const ASSISTANT_TOOLS = [
  {
    name: "add_goal",
    description:
      "Create a new goal. If the user gives a specific day (today, tomorrow, or a date), schedule it there. If no day is mentioned, add it to the Backlog instead — a holding pen for goals not yet committed to a day.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short goal title." },
        details: { type: "string", description: "Optional extra detail." },
        priority: { type: "integer", minimum: 1, maximum: 5, description: "1 = highest priority, 5 = lowest. Default 3 if unspecified." },
        date_iso: { type: "string", description: "YYYY-MM-DD to schedule on a specific day. Omit entirely to add to the Backlog instead." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_goal_status",
    description:
      "Change an existing goal's status. Use the goal_id from the goal list provided in context — match it by title from the user's request. If the new status is 'blocked', you must also ask the user for a reason before calling this (blocked_reason is required for that status).",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "The id of the goal to update, from the provided goal list." },
        status: {
          type: "string",
          enum: ["completed", "in_progress", "blocked", "canceled"],
          description: "The new status.",
        },
        blocked_reason: { type: "string", description: "Required when status is 'blocked' — why it's blocked." },
      },
      required: ["goal_id", "status"],
    },
  },
  {
    name: "reschedule_goal",
    description: "Move an existing goal to a different day.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "The id of the goal to reschedule, from the provided goal list." },
        to_date_iso: { type: "string", description: "YYYY-MM-DD to move the goal to." },
        reason: { type: "string", description: "Optional reason for rescheduling." },
      },
      required: ["goal_id", "to_date_iso"],
    },
  },
  {
    name: "move_goal_to_backlog",
    description:
      "Move an already-scheduled goal into the undated Backlog — for a goal the user isn't sure they'll get to on any particular day. Notes, checklist items, and attached files on the goal are not preserved; mention that if it seems relevant.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "The id of the goal to move, from the provided goal list." },
      },
      required: ["goal_id"],
    },
  },
  {
    name: "remove_goal",
    description:
      "Permanently delete a goal — use this when the user asks to remove, delete, or get rid of a goal entirely (not reschedule it, not move it to Backlog). This cannot be undone, and any notes, checklist items, or attached files on the goal are permanently deleted with it.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "The id of the goal to delete, from the provided goal list." },
      },
      required: ["goal_id"],
    },
  },
] as const;
