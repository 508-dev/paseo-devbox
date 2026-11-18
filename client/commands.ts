const shellSafeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const observedServiceId = /^service_[a-f0-9]{20}$/;
const observedWorkspaceId = /^workspace_[a-f0-9]{32}$/;

export const WORKTREE_HANDOFFS = [
  { label: "VS Code", tool: "code" },
  { label: "SSH shell", tool: "shell" },
  { label: "Claude Desktop", tool: "claude-desktop" },
  { label: "Codex desktop setup", tool: "codex-desktop" },
] as const;

export type HandoffTool = (typeof WORKTREE_HANDOFFS)[number]["tool"];

export function isComputerId(value: string): boolean {
  return shellSafeIdentifier.test(value);
}

function hostFlags(computerId: string, paseoHostId: string): string | null {
  if (!isComputerId(computerId) || !shellSafeIdentifier.test(paseoHostId)) return null;
  return `--computer ${computerId} --paseo-host ${paseoHostId}`;
}

export function previewCommand(
  computerId: string,
  paseoHostId: string,
  serviceId: string,
  kind: "http" | "tcp",
): string | null {
  const host = hostFlags(computerId, paseoHostId);
  if (!host || !observedServiceId.test(serviceId)) return null;
  // A TCP listener can be forwarded by its observed ID, without opening a browser.
  return `devbox preview ${serviceId} ${host}${kind === "tcp" ? " --no-open" : ""}`;
}

export function declaredPreviewCommand(
  computerId: string,
  paseoHostId: string,
  paseoWorkspaceId: string,
  scriptName: string,
): string | null {
  const host = hostFlags(computerId, paseoHostId);
  if (!host || !shellSafeIdentifier.test(paseoWorkspaceId) || !shellSafeIdentifier.test(scriptName))
    return null;
  return `devbox preview ${scriptName} ${host} --paseo-workspace ${paseoWorkspaceId}`;
}

export function worktreeCommand(
  computerId: string,
  paseoHostId: string,
  workspaceId: string,
  tool: HandoffTool,
): string | null {
  const host = hostFlags(computerId, paseoHostId);
  if (
    !host ||
    !observedWorkspaceId.test(workspaceId) ||
    !WORKTREE_HANDOFFS.some((entry) => entry.tool === tool)
  )
    return null;
  return `devbox open ${host} --workspace ${workspaceId} --with ${tool}`;
}
