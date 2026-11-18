import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { workspaceInventoryInput, workspaceInventoryOutput } from "../shared/schemas.ts";
import {
  createWorkspaceInventoryReader,
  lookupWorkspace,
  readHelperInventory,
} from "./inventory.ts";

const now = Date.parse("2026-11-18T06:00:00.000Z");
const root = "/home/owner/dev/my checkout";
const currentId = `workspace_${"a".repeat(32)}`;
const otherId = `workspace_${"b".repeat(32)}`;
const serviceId = `service_${"a".repeat(20)}`;
const otherServiceId = `service_${"b".repeat(20)}`;
const workspaceId = "wks_example";
const current = {
  workspaceId: currentId,
  rootPath: root,
  branch: "feature/test",
  repositoryId: "not returned",
};
const other = { workspaceId: otherId, rootPath: `${root}-different`, branch: "feature/test" };
const inventory = {
  version: 1,
  scannedAt: new Date(now - 5000).toISOString(),
  reportedAt: new Date(now - 500).toISOString(),
  truncated: false,
  workspaces: [current, other],
};
const service = {
  serviceId,
  projectId: currentId,
  source: "process_socket",
  transport: "http",
  bindHost: "127.0.0.1",
  remotePort: 3000,
  processId: 1234,
};
const paseoworkspace = {
  id: workspaceId,
  workspaceDirectory: "/alias/my checkout",
  projectRootPath: "/home/owner/dev/main",
  workspaceKind: "worktree",
  scripts: [
    {
      scriptName: "web",
      type: "service",
      port: 3000,
      lifecycle: "running",
      health: "healthy",
      proxyUrl: "sensitive URL",
    },
    { scriptName: "db", type: "service", port: null, lifecycle: "stopped", health: null },
    { scriptName: "setup", type: "script", port: 2022, lifecycle: "running", health: null },
    {
      scriptName: "invalid service",
      type: "service",
      port: 65536,
      lifecycle: "running",
      health: null,
    },
  ],
};
const dependencies = {
  lookup: async () => paseoworkspace,
  now: () => now,
  directory: async () => root,
};

test("reads only the selected canonical worktree and separates declared status from observed sockets", async () => {
  const commands: string[] = [];
  const read = createWorkspaceInventoryReader();
  const result = await read(workspaceId, {
    ...dependencies,
    lookup: async (id) => {
      assert.equal(id, workspaceId);
      return paseoworkspace;
    },
    directory: async (value) => {
      assert.equal(value, paseoworkspace.workspaceDirectory);
      return root;
    },
    helper: async (command) => {
      commands.push(command);
      return {
        status: "available",
        inventory: {
          ...inventory,
          services: [
            service,
            { ...service, serviceId: otherServiceId, projectId: otherId, remotePort: 3001 },
          ],
        },
      };
    },
  });
  assert.deepEqual(commands, ["services"]);
  assert.deepEqual(workspaceInventoryOutput.parse(result), {
    status: "ready",
    workspace: { rootPath: root, branch: "feature/test", devboxWorkspaceId: currentId },
    services: [{ serviceId, remotePort: 3000, kind: "http" }],
    declaredServices: [
      { name: "web", remotePort: 3000, state: "running", health: "healthy" },
      { name: "db", remotePort: null, state: "stopped", health: null },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /sensitive URL|processId|repositoryId|different/);
});

test("stale, partial, ambiguous and impossible socket claims never produce an actionable service", async () => {
  const read = createWorkspaceInventoryReader();
  for (const bad of [
    { ...inventory, truncated: true, services: [service] },
    { ...inventory, scannedAt: new Date(now - 121_000).toISOString(), services: [service] },
    { ...inventory, reportedAt: new Date(now + 1).toISOString(), services: [service] },
    {
      ...inventory,
      services: [service, { ...service, serviceId: otherServiceId, projectId: otherId }],
    },
    { ...inventory, services: [{ ...service, projectId: `workspace_${"c".repeat(32)}` }] },
    { ...inventory, services: [{ ...service, serviceId: "12345" }] },
    { ...inventory, services: [{ ...service, bindHost: "10.0.0.12" }] },
    { ...inventory, workspaces: [current, current], services: [service] },
  ]) {
    const result = await read(workspaceId, {
      ...dependencies,
      helper: async (command) =>
        command === "services"
          ? { status: "available", inventory: bad }
          : {
              status: "available",
              inventory: { ...inventory, roots: ["/home/owner/dev"], staleWorkspaceIds: [] },
            },
    });
    assert.equal(result.status, "inventory_unavailable");
    assert.deepEqual(result.services, []);
    assert.equal(result.workspace?.devboxWorkspaceId, currentId);
  }
  const result = await read(workspaceId, {
    ...dependencies,
    helper: async () => ({
      status: "available",
      inventory: { ...inventory, workspaces: [other], services: [] },
    }),
  });
  assert.equal(result.status, "not_indexed");
  assert.equal(result.workspace?.devboxWorkspaceId, null);
});

test("unknown and malformed workspace selections stop before helper access", async () => {
  assert.throws(() => workspaceInventoryInput.parse({ workspaceId, cwd: root }));
  const read = createWorkspaceInventoryReader();
  let reads = 0;
  for (const lookup of [
    async () => null,
    async () => ({ ...paseoworkspace, id: "wks_different" }),
    async () => ({ ...paseoworkspace, workspaceDirectory: "/../../outside" }),
    async () => ({ ...paseoworkspace, archivingAt: "now" }),
    async () => ({ ...paseoworkspace, workspaceDirectory: paseoworkspace.projectRootPath }),
  ]) {
    const result = await read(workspaceId, {
      ...dependencies,
      lookup,
      helper: async () => {
        reads++;
        return { status: "helper_missing" };
      },
    });
    assert.deepEqual(result, {
      workspace: null,
      status: "workspace_unavailable",
      services: [],
      declaredServices: [],
    });
  }
  assert.equal(reads, 0);
});

test("missing helper keeps Paseo's declared services available", async () => {
  const result = await createWorkspaceInventoryReader()(workspaceId, {
    ...dependencies,
    helper: async () => ({ status: "helper_missing" }),
  });
  assert.equal(result.status, "helper_missing");
  assert.equal(result.workspace?.devboxWorkspaceId, null);
  assert.equal(result.declaredServices.length, 2);
});

test("lookup pages bound fanout and use an exact ID", async () => {
  const cursors: (string | undefined)[] = [];
  const missing = await lookupWorkspace(workspaceId, async (cursor) => {
    cursors.push(cursor);
    return {
      entries: [{ ...paseoworkspace, id: `${workspaceId}-different` }],
      pageInfo: { nextCursor: `cursor-${cursors.length}` },
    };
  });
  assert.equal(missing, null);
  assert.deepEqual(cursors, [undefined, "cursor-1", "cursor-2"]);
  const found = await lookupWorkspace(workspaceId, async (cursor) =>
    cursor === undefined
      ? { entries: [], pageInfo: { nextCursor: "second" } }
      : { entries: [paseoworkspace], pageInfo: {} },
  );
  assert.equal(found?.id, workspaceId);
});

test("concurrent queries coalesce by workspace and have two scan slots", async () => {
  const read = createWorkspaceInventoryReader();
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const input = {
    ...dependencies,
    lookup: async (id: string) => ({ ...paseoworkspace, id }),
    helper: async () => {
      calls++;
      await barrier;
      return { status: "helper_missing" as const };
    },
  };
  const first = read(workspaceId, input);
  assert.equal(read(workspaceId, input), first);
  const second = read("wks_second", input);
  assert.equal((await read("wks_third", input)).status, "busy");
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal((await read("wks_third", input)).status, "helper_missing");
  assert.equal(calls, 3);
});

async function scratch(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "paseo-devbox-test-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("installed helpers get fixed argv and a narrow environment without PATH or shell fallback", async (t) => {
  const home = await scratch(t);
  const systemHelper = join(home, "unused-system-helper");
  const helper = join(home, ".local/bin/remote-workspace");
  const environment = {
    XDG_STATE_HOME: join(home, "private state"),
    PATH: home,
    SECRET_STUFF: "sensitive",
  };
  await writeFile(join(home, "remote-workspace"), "#!/bin/sh\nexit 42\n", { mode: 0o700 });
  assert.deepEqual(await readHelperInventory("services", { home, environment, systemHelper }), {
    status: "helper_missing",
  });
  await mkdir(dirname(helper), { recursive: true });
  await writeFile(
    helper,
    `#!/bin/sh
test "$#" = 1 && test "$1" = services && test -z "$SECRET_STUFF" || exit 1
printf '%s' '{"safe":true}'
`,
    { mode: 0o700 },
  );
  assert.deepEqual(await readHelperInventory("services", { home, environment, systemHelper }), {
    status: "available",
    inventory: { safe: true },
  });
  assert.deepEqual(await readHelperInventory("inventory", { home, environment, systemHelper }), {
    status: "inventory_unavailable",
  });
});

test("uses the installed signed runtime when there is no PATH wrapper", async (t) => {
  const home = await scratch(t);
  const data = join(home, "data");
  const install = join(data, "508-remote");
  const release = join(install, "releases/test-release");
  const runtime = join(release, "runtime/bin/node");
  const entry = join(release, "apps/daemon/dist/workspace-cli.js");
  await mkdir(dirname(runtime), { recursive: true });
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(
    runtime,
    `#!/bin/sh
test "$#" = 2 && test "$2" = inventory && test -f "$1" || exit 1
printf '%s' '{"signedLayout":true}'
`,
    { mode: 0o700 },
  );
  await writeFile(entry, "");
  await symlink(release, join(install, "current"), "dir");
  const environment = { XDG_DATA_HOME: data };
  assert.deepEqual(await readHelperInventory("inventory", { home, environment }), {
    status: "available",
    inventory: { signedLayout: true },
  });
});

test("plugin cleanup aborts a helper process that already started", async (t) => {
  const home = await scratch(t);
  const helper = join(home, ".local/bin/remote-workspace");
  const started = join(home, "started");
  await mkdir(dirname(helper), { recursive: true });
  await writeFile(helper, '#!/bin/sh\nprintf started > "$HOME/started"\nexec /bin/sleep 30\n', {
    mode: 0o700,
  });
  const lifecycle = new AbortController();
  t.after(() => lifecycle.abort());
  const request = readHelperInventory("services", {
    home,
    environment: {},
    signal: lifecycle.signal,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await stat(started).then(
        () => true,
        () => false,
      )
    )
      break;
    await delay(10);
  }
  assert.equal((await stat(started)).isFile(), true);
  lifecycle.abort();
  assert.deepEqual(await request, { status: "inventory_unavailable" });
});
