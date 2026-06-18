import type { CollaborationAction } from "./schemas.js";
import { nowIso } from "./utils.js";

export function action(agent: string, actionName: string, details: string): CollaborationAction {
  return {
    at: nowIso(),
    agent,
    action: actionName,
    details
  };
}
