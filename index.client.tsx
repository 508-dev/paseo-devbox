import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DevboxPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "devbox",
    title: "Devbox",
    icon: "Monitor",
    locations: ["workspace", "explorer"],
    Component: DevboxPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-devbox",
    title: "Devbox previews and workspace handoff",
    icon: "Monitor",
    context: "workspace",
    keywords: ["port", "forward", "preview", "editor", "ssh", "worktree"],
    onSelect({ openPanel }) {
      openPanel("devbox");
    },
  });
  return () => {
    removeCommand();
    removePanel();
  };
}
