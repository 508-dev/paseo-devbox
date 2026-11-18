import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type WorkspaceInventory, workspaceInventoryRpc } from "../shared/inventory.ts";
import {
  declaredPreviewCommand,
  isComputerId,
  previewCommand,
  WORKTREE_HANDOFFS,
  worktreeCommand,
} from "./commands";

const inventoryMessages: Record<Exclude<WorkspaceInventory["status"], "ready">, string> = {
  workspace_unavailable: "This Paseo workspace is unavailable. Check the selected host and retry.",
  helper_missing:
    "Install or update the signed Devbox host helper to find this worktree and its listeners.",
  inventory_unavailable:
    "Devbox inventory is unavailable or stale. Refresh it on the host and try again.",
  not_indexed:
    "This worktree is outside the current Devbox inventory. Register its exact folder with Devbox and refresh.",
  busy: "The host is already checking its inventory. Try again shortly.",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; inventory: WorkspaceInventory };

export function DevboxPanel(props: PluginWorkspacePanelProps) {
  return <WorkspaceDetails key={JSON.stringify([props.host.id, props.workspaceId])} {...props} />;
}

function WorkspaceDetails({ theme, layout, host, workspaceId }: PluginWorkspacePanelProps) {
  const name = useWorkspace(workspaceId, (workspace) => workspace.name);
  const load = useRpc(workspaceInventoryRpc);
  const [request, setRequest] = useState({ workspaceId });
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [computerId, setComputerId] = useState("");
  const toast = useToast();

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void load(request).then(
      (inventory) => {
        if (active) setState({ kind: "loaded", inventory });
      },
      () => {
        if (active) setState({ kind: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [load, request]);

  const palette = theme.colors;
  const fg = { color: palette.foreground };
  const muted = { color: palette.foregroundMuted };
  const title = { ...fg, fontWeight: "600" as const, fontSize: 15 };
  const card = { gap: 6, padding: 12, backgroundColor: palette.surface1, borderRadius: 8 };
  const button = {
    alignSelf: "flex-start" as const,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: palette.surface2,
    borderRadius: 6,
  };
  const id = computerId.trim();
  const idValid = isComputerId(id);
  const inventory = state.kind === "loaded" ? state.inventory : null;
  const observedWorkspace = inventory?.workspace;
  const workspaceTarget = observedWorkspace?.devboxWorkspaceId;
  const hasDeclaredPreview = inventory?.declaredServices.some(
    (service) =>
      service.state === "running" && service.remotePort !== null && service.health !== "unhealthy",
  );

  async function copy(command: string) {
    try {
      await copyText(command);
      toast.show("Copied. Run the command in your laptop terminal.", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the command text and copy it manually.");
    }
  }

  function renderCommand(command: string, label: string) {
    return (
      <View style={{ gap: 6 }}>
        <Text selectable style={fg}>
          {command}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => void copy(command)}
          style={button}
        >
          <Text style={fg}>Copy command</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 12 : 18, gap: 14 }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ ...title, fontSize: 19 }}>{name ?? "Devbox workspace"}</Text>
        <Text style={muted}>{host.label}</Text>
        {observedWorkspace && (
          <View style={{ gap: 4 }}>
            <Text style={fg}>{observedWorkspace.branch ?? "No branch reported"}</Text>
            <Text selectable style={muted}>
              {observedWorkspace.rootPath}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Devbox workspace inventory"
          disabled={state.kind === "loading"}
          style={button}
          onPress={() => {
            setState({ kind: "loading" });
            setRequest({ workspaceId });
          }}
        >
          <Text style={state.kind === "loading" ? muted : fg}>
            {state.kind === "loading" ? "Checking host…" : "Refresh"}
          </Text>
        </Pressable>
      </View>

      {state.kind === "error" && (
        <Text accessibilityLiveRegion="polite" style={fg}>
          Could not reach the workspace check. Check the Paseo host connection and refresh.
        </Text>
      )}
      {inventory && inventory.status !== "ready" && (
        <Text accessibilityLiveRegion="polite" style={fg}>
          {inventoryMessages[inventory.status]}
        </Text>
      )}
      {inventory && (
        <View style={{ gap: 12 }}>
          {(workspaceTarget || inventory.services.length > 0 || hasDeclaredPreview) && (
            <View style={card}>
              <Text style={title}>Your laptop connection</Text>
              <Text style={muted}>
                Enter the computer ID shown by devbox connection list on your laptop.
              </Text>
              <TextInput
                accessibilityLabel="Saved Devbox computer ID"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={255}
                onChangeText={setComputerId}
                placeholder="e.g. lab"
                placeholderTextColor={palette.foregroundMuted}
                style={{
                  ...fg,
                  backgroundColor: palette.surface0,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: 6,
                }}
                value={computerId}
              />
              {id !== "" && !idValid && (
                <Text style={fg}>
                  Use the saved ID with letters, digits, dots, colons, underscores, or hyphens.
                </Text>
              )}
            </View>
          )}
          <View style={{ gap: 8 }}>
            <Text style={title}>Paseo services</Text>
            {inventory.declaredServices.length === 0 && (
              <Text style={muted}>No declared Paseo services were reported for this worktree.</Text>
            )}
            {inventory.declaredServices.map((service) => {
              const command =
                service.state === "running" &&
                service.remotePort !== null &&
                service.health !== "unhealthy"
                  ? declaredPreviewCommand(id, host.id, workspaceId, service.name)
                  : null;
              return (
                <View key={service.name} style={card}>
                  <Text style={title}>{service.name}</Text>
                  <Text style={muted}>
                    {service.state === "running" ? "Running on host" : "Stopped"}
                    {service.remotePort !== null ? ` · Port ${service.remotePort}` : ""}
                    {service.health ? ` · ${service.health}` : ""}
                  </Text>
                  {command && renderCommand(command, `Copy preview command for ${service.name}`)}
                </View>
              );
            })}
          </View>
          {inventory.status === "ready" && (
            <View style={{ gap: 8 }}>
              <Text style={title}>Detected listeners</Text>
              <Text style={muted}>
                Run a preview command on your laptop to start a private forward.
              </Text>
              {inventory.services.length === 0 && (
                <Text style={muted}>
                  No listeners were attributed to this worktree at the last refresh.
                </Text>
              )}
              {inventory.services.map((service) => {
                const command = previewCommand(id, host.id, service.serviceId, service.kind);
                return (
                  <View key={service.serviceId} style={card}>
                    <Text style={title}>
                      {service.kind.toUpperCase()} {service.remotePort}
                    </Text>
                    <Text style={muted}>Detected on host</Text>
                    {command &&
                      renderCommand(command, `Copy preview command for port ${service.remotePort}`)}
                  </View>
                );
              })}
            </View>
          )}
          {workspaceTarget && (
            <View style={{ gap: 8 }}>
              <Text style={title}>Open this worktree in another tool</Text>
              <Text style={muted}>
                Run the command on your laptop. Codex desktop opens SSH setup first.
              </Text>
              {WORKTREE_HANDOFFS.map(({ label, tool }) => {
                const command = worktreeCommand(id, host.id, workspaceTarget, tool);
                return (
                  <View key={tool} style={card}>
                    <Text style={title}>{label}</Text>
                    {command && renderCommand(command, `Copy command to open in ${label}`)}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
