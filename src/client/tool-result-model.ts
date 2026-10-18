/**
 * Which tool results get a structured card in the process flow's expanded result area.
 *
 * Kept free of CSS/React so the catalog test can import it without a DOM or a stylesheet loader.
 * Deliberately NOT here: `subagent` (its answer is prose), `skill` (its body is instructions for the
 * model, already rendered as markdown), and `terminal_*` (the terminal block has its own output).
 */
const CARD_NAMES = new Set([
  'job_output', 'job_list', 'job_kill',
  'cordis_inspect_list', 'cordis_inspect_query',
  'plugin_manager', 'plugin_market',
  'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
  'exit_plan_mode',
  'create_goal', 'get_goal', 'update_goal',
  'schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update',
  'lsp',
  'session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read',
  'list_subagent_models', 'list_agents', 'send_message', 'interrupt_agent',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
  'working_directory',
  'create_worktree', 'workflow', 'ralph',
  'load_workspace_dependencies',
  'stagehand_act', 'stagehand_extract', 'stagehand_navigate', 'stagehand_observe', 'stagehand_screenshot', 'stagehand_tabs',
]);

export function isStructuredTool(name: string): boolean {
  return CARD_NAMES.has(name);
}
