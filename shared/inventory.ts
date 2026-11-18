import { defineRpc } from "@getpaseo/plugin";
import { workspaceInventoryInput, workspaceInventoryOutput } from "./schemas.ts";

export type { WorkspaceInventory } from "./schemas.ts";

export const workspaceInventoryRpc = defineRpc({
  name: "workspace.inventory",
  input: workspaceInventoryInput,
  output: workspaceInventoryOutput,
});
