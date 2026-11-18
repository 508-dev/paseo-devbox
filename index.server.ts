import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  createWorkspaceInventoryReader,
  lookupWorkspace,
  readHelperInventory,
} from "./server/inventory.ts";
import { workspaceInventoryRpc } from "./shared/inventory.ts";

export default function contribute(server: PluginServerContext) {
  const lifecycle = new AbortController();
  const readInventory = createWorkspaceInventoryReader();
  server.handle(workspaceInventoryRpc, ({ workspaceId }, { paseo }) =>
    readInventory(workspaceId, {
      helper: (command) => readHelperInventory(command, { signal: lifecycle.signal }),
      lookup: (id) =>
        lookupWorkspace(id, (cursor) =>
          paseo.workspaces.list({
            includeBackground: true,
            page: { limit: 200, ...(cursor ? { cursor } : {}) },
          }),
        ),
    }),
  );
  return () => lifecycle.abort();
}
