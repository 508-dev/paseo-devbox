import { execFile } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  branchSchema,
  declaredServiceSchema,
  pathSchema,
  portSchema,
  serviceKeySchema,
  timestampSchema,
  type WorkspaceInventory,
  workspaceInventoryInput,
  workspaceKeySchema,
} from "../shared/schemas.ts";

const executeFile = promisify(execFile);
const CHECK_TIMEOUT_MS = 12_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_AGE_MS = 120_000;
const MAX_IN_FLIGHT = 2;
const SERVICE_LIMIT = 64;
const commonFields = {
  version: z.literal(1),
  scannedAt: timestampSchema,
  reportedAt: timestampSchema.optional(),
  truncated: z.boolean(),
};
const indexedWorkspace = z.object({
  workspaceId: workspaceKeySchema,
  rootPath: pathSchema,
  branch: branchSchema,
});
const serviceInventorySchema = z.object({
  ...commonFields,
  workspaces: z.array(indexedWorkspace).max(128),
  services: z
    .array(
      z.object({
        serviceId: serviceKeySchema,
        projectId: workspaceKeySchema,
        source: z.literal("process_socket"),
        transport: z.enum(["http", "tcp"]),
        bindHost: z.enum(["127.0.0.1", "0.0.0.0"]),
        remotePort: portSchema,
      }),
    )
    .max(SERVICE_LIMIT),
});
const workspaceInventorySchema = z.object({
  ...commonFields,
  roots: z.array(pathSchema).max(64),
  workspaces: z.array(indexedWorkspace).max(256),
  staleWorkspaceIds: z.array(workspaceKeySchema).max(256),
});

interface WorkspaceSnapshot {
  readonly id: string;
  readonly workspaceDirectory?: string;
  readonly workspaceKind: string;
  readonly projectRootPath: string;
  readonly archivingAt?: string | null;
  readonly scripts: readonly unknown[];
  readonly gitRuntime?: { readonly currentBranch?: string | null } | null;
}

type HelperResult =
  | { readonly status: "available"; readonly inventory: unknown }
  | { readonly status: "helper_missing" | "inventory_unavailable" };

type HelperCommand = "services" | "inventory";
interface InventoryDependencies {
  readonly lookup: (workspaceId: string) => Promise<WorkspaceSnapshot | null>;
  readonly helper?: (command: HelperCommand) => Promise<HelperResult>;
  readonly directory?: (path: string) => Promise<string>;
  readonly now?: () => number;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function helperEnvironment(home: string, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { HOME: home, PATH: "/usr/local/bin:/usr/bin:/bin" };
  for (const key of [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "FIVE08_REMOTE_WORKSPACE_INDEX_FILE",
    "FIVE08_REMOTE_WORKSPACE_REGISTRY_FILE",
  ]) {
    const value = source[key];
    if (value && isAbsolute(value)) environment[key] = value;
  }
  return environment;
}

async function helperCommand(home: string, environment: NodeJS.ProcessEnv, systemHelper: string) {
  const install = join(environment.XDG_DATA_HOME ?? join(home, ".local/share"), "508-remote");
  try {
    await lstat(join(install, "current"));
    const release = await realpath(join(install, "current"));
    // A signed user install switches this one pointer to a release inside its own store.
    if (dirname(release) !== (await realpath(join(install, "releases")))) {
      throw new Error("Invalid release placement");
    }
    return {
      executable: join(release, "runtime/bin/node"),
      argv: [join(release, "apps/daemon/dist/workspace-cli.js")],
    };
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  for (const executable of [join(home, ".local/bin/remote-workspace"), systemHelper]) {
    try {
      const info = await lstat(executable);
      if (!info.isFile()) throw new Error("The workspace helper must be a regular file");
      return { executable, argv: [] };
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return null;
}

/** Run only an installed helper, without a shell, repository arguments or inherited secrets. */
export async function readHelperInventory(
  command: HelperCommand,
  options: {
    home?: string;
    environment?: NodeJS.ProcessEnv;
    systemHelper?: string;
    signal?: AbortSignal;
  } = {},
): Promise<HelperResult> {
  if (command !== "services" && command !== "inventory") return { status: "inventory_unavailable" };
  const home = options.home ?? homedir();
  const environment = helperEnvironment(home, options.environment ?? process.env);
  try {
    if (options.signal?.aborted) return { status: "inventory_unavailable" };
    const helper = await helperCommand(
      home,
      environment,
      options.systemHelper ?? "/usr/local/bin/remote-workspace",
    );
    if (options.signal?.aborted) return { status: "inventory_unavailable" };
    if (!helper) return { status: "helper_missing" };
    const { stdout } = await executeFile(helper.executable, [...helper.argv, command], {
      cwd: home,
      env: environment,
      encoding: "utf8",
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      killSignal: "SIGKILL",
      signal: options.signal,
    });
    return { status: "available", inventory: JSON.parse(stdout) };
  } catch {
    return { status: "inventory_unavailable" };
  }
}

interface WorkspacePage {
  readonly entries: readonly WorkspaceSnapshot[];
  readonly pageInfo: { readonly nextCursor?: string | null };
}

/** Limit SDK directory pages as well as helper processes on an unusually large host. */
export async function lookupWorkspace(
  workspaceId: string,
  list: (cursor?: string) => Promise<WorkspacePage>,
): Promise<WorkspaceSnapshot | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const result = await list(cursor);
    if (result.entries.length > 200) return null;
    const matches = result.entries.filter((entry) => entry.id === workspaceId);
    if (matches.length) return matches.length === 1 ? (matches[0] ?? null) : null;
    const next = result.pageInfo.nextCursor;
    if (!next || next === cursor) return null;
    cursor = next;
  }
  return null;
}

function isFresh(
  data: { scannedAt: string; reportedAt?: string | undefined; truncated: boolean },
  now: number,
): boolean {
  const started = Date.parse(data.scannedAt);
  const reported = data.reportedAt ? Date.parse(data.reportedAt) : now;
  return !data.truncated && started <= reported && reported <= now && now - started <= MAX_AGE_MS;
}

function unique(values: readonly (string | number)[]): boolean {
  return new Set(values).size === values.length;
}

function validWorkspaceRows(rows: readonly z.infer<typeof indexedWorkspace>[]): boolean {
  return unique(rows.map((row) => row.workspaceId)) && unique(rows.map((row) => row.rootPath));
}

function declaredServices(scripts: readonly unknown[]): WorkspaceInventory["declaredServices"] {
  const services: WorkspaceInventory["declaredServices"] = [];
  const names = new Set<string>();
  for (const script of scripts.slice(0, SERVICE_LIMIT)) {
    if (!script || typeof script !== "object" || !("type" in script) || script.type !== "service")
      continue;
    const row = script as Record<string, unknown>;
    const result = declaredServiceSchema.safeParse({
      name: row.scriptName,
      remotePort: row.port,
      state: row.lifecycle,
      health: row.health,
    });
    if (!result.success || names.has(result.data.name)) continue;
    names.add(result.data.name);
    services.push(result.data);
  }
  return services;
}

function unavailable(status: "workspace_unavailable" | "busy"): WorkspaceInventory {
  return { status, workspace: null, services: [], declaredServices: [] };
}

async function canonicalDirectory(path: string): Promise<string> {
  const root = await realpath(path);
  if (!(await stat(root)).isDirectory()) throw new Error("Paseo workspace is unavailable");
  return root;
}

async function loadWorkspaceInventory(
  workspaceId: string,
  dependencies: InventoryDependencies,
): Promise<WorkspaceInventory> {
  let snapshot: WorkspaceSnapshot | null;
  let rootPath: string;
  try {
    snapshot = await dependencies.lookup(workspaceId);
    if (
      !snapshot ||
      snapshot.id !== workspaceId ||
      snapshot.archivingAt ||
      (snapshot.workspaceKind === "worktree" &&
        snapshot.workspaceDirectory === snapshot.projectRootPath)
    ) {
      return unavailable("workspace_unavailable");
    }
    const directory = pathSchema.parse(snapshot.workspaceDirectory);
    rootPath = pathSchema.parse(await (dependencies.directory ?? canonicalDirectory)(directory));
  } catch {
    return unavailable("workspace_unavailable");
  }

  const now = dependencies.now ?? Date.now;
  const helper = dependencies.helper ?? readHelperInventory;
  const declared = declaredServices(snapshot.scripts);
  const workspace = {
    rootPath,
    branch: branchSchema.safeParse(snapshot.gitRuntime?.currentBranch).data ?? null,
    devboxWorkspaceId: null,
  };
  const base = { workspace, declaredServices: declared, services: [] };
  try {
    const detected = await helper("services");
    if (detected.status === "helper_missing") return { ...base, status: detected.status };
    if (detected.status === "available") {
      const result = serviceInventorySchema.safeParse(detected.inventory);
      if (
        result.success &&
        isFresh(result.data, now()) &&
        validWorkspaceRows(result.data.workspaces)
      ) {
        const workspaces = new Set(result.data.workspaces.map((row) => row.workspaceId));
        const { services } = result.data;
        if (
          unique(services.map((service) => service.serviceId)) &&
          unique(services.map((service) => service.remotePort)) &&
          services.every((service) => workspaces.has(service.projectId))
        ) {
          const found = result.data.workspaces.find((row) => row.rootPath === rootPath);
          if (!found) return { ...base, status: "not_indexed" };
          return {
            ...base,
            status: "ready",
            workspace: { rootPath, branch: found.branch, devboxWorkspaceId: found.workspaceId },
            services: services
              .filter((service) => service.projectId === found.workspaceId)
              .map(({ serviceId, remotePort, transport }) => ({
                serviceId,
                remotePort,
                kind: transport,
              })),
          };
        }
      }
    }

    // Cached inventory may still identify the worktree when the socket scan is unavailable.
    const cached = await helper("inventory");
    if (cached.status !== "available") return { ...base, status: "inventory_unavailable" };
    const result = workspaceInventorySchema.safeParse(cached.inventory);
    if (
      !result.success ||
      !isFresh(result.data, now()) ||
      !validWorkspaceRows(result.data.workspaces)
    ) {
      return { ...base, status: "inventory_unavailable" };
    }
    const found = result.data.workspaces.find((row) => row.rootPath === rootPath);
    if (!found) return { ...base, status: "not_indexed" };
    if (
      result.data.staleWorkspaceIds.includes(found.workspaceId) ||
      !result.data.roots.some((root) => rootPath === root || rootPath.startsWith(`${root}/`))
    )
      return { ...base, status: "inventory_unavailable" };
    return {
      ...base,
      status: "inventory_unavailable",
      workspace: { rootPath, branch: found.branch, devboxWorkspaceId: found.workspaceId },
    };
  } catch {
    return { ...base, status: "inventory_unavailable" };
  }
}

/** Coalesce repeats and cap expensive scans across all plugin clients on this daemon. */
export function createWorkspaceInventoryReader() {
  const pending = new Map<string, Promise<WorkspaceInventory>>();
  return (
    workspaceId: string,
    dependencies: InventoryDependencies,
  ): Promise<WorkspaceInventory> => {
    if (!workspaceInventoryInput.safeParse({ workspaceId }).success) {
      return Promise.resolve(unavailable("workspace_unavailable"));
    }
    const active = pending.get(workspaceId);
    if (active) return active;
    if (pending.size >= MAX_IN_FLIGHT) return Promise.resolve(unavailable("busy"));
    const request = loadWorkspaceInventory(workspaceId, dependencies).finally(() => {
      pending.delete(workspaceId);
    });
    pending.set(workspaceId, request);
    return request;
  };
}
