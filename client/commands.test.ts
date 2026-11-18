import assert from "node:assert/strict";
import test from "node:test";
import { declaredPreviewCommand, previewCommand, worktreeCommand } from "./commands.ts";

const serviceA = "service_0123456789abcdef0123";
const serviceB = "service_9123456789abcdef0123";
const workspace = "workspace_0123456789abcdef0123456789abcdef";

test("copying previews binds both the observed service and the Paseo host", () => {
  assert.equal(
    previewCommand("laptop-saved-box", "srv_Alpha", serviceA, "http"),
    `devbox preview ${serviceA} --computer laptop-saved-box --paseo-host srv_Alpha`,
  );
  assert.equal(
    previewCommand("laptop-saved-box", "srv_Beta", serviceB, "tcp"),
    `devbox preview ${serviceB} --computer laptop-saved-box --paseo-host srv_Beta --no-open`,
  );
  assert.equal(previewCommand("box", "srv_Alpha", "3000", "http"), null);
  assert.equal(previewCommand("-other-box", "srv_Alpha", serviceA, "http"), null);
  assert.equal(previewCommand("box", "srv_Alpha other", serviceA, "http"), null);
});

test("editor commands use an exact observed workspace ID and a supported editor", () => {
  assert.equal(
    worktreeCommand("box", "srv_Alpha", workspace, "codex-desktop"),
    `devbox open --computer box --paseo-host srv_Alpha --workspace ${workspace} --with codex-desktop`,
  );
  assert.equal(worktreeCommand("box", "srv_Alpha", "main", "code"), null);
  assert.equal(worktreeCommand("box", "srv_Alpha", workspace, "other" as "code"), null);
});

test("a declared service uses its script name and the selected Paseo workspace", () => {
  assert.equal(
    declaredPreviewCommand("box", "srv_Alpha", "wks_1", "web"),
    "devbox preview web --computer box --paseo-host srv_Alpha --paseo-workspace wks_1",
  );
  assert.equal(
    declaredPreviewCommand("box", "srv_Alpha", "wks_2", "web"),
    "devbox preview web --computer box --paseo-host srv_Alpha --paseo-workspace wks_2",
  );
  assert.equal(declaredPreviewCommand("box", "srv_Alpha", "wks_1", "-web"), null);
  assert.equal(declaredPreviewCommand("box", "srv_Alpha", "--no-open", "web"), null);
});
