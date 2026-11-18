import { z } from "zod";

const cleanText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) =>
      Array.from(value).every((character) => character >= " " && character.charCodeAt(0) !== 127),
    );
export const branchSchema = cleanText(1024).nullable();
export const pathSchema = cleanText(4096).refine(
  (path) =>
    path.startsWith("/") &&
    path
      .split("/")
      .slice(1)
      .every((part) => part !== "" && part !== "." && part !== ".."),
);
export const portSchema = z.number().int().min(1).max(65535);
export const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  .refine((value) => {
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19)
    );
  });
export const workspaceKeySchema = z.string().regex(/^workspace_[a-f0-9]{32}$/);
export const serviceKeySchema = z.string().regex(/^service_[a-f0-9]{20}$/);

export const workspaceInventoryInput = z
  .object({
    workspaceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,254}$/),
  })
  .strict();

export const declaredServiceSchema = z
  .object({
    name: cleanText(256),
    remotePort: portSchema.nullable(),
    state: z.enum(["running", "stopped"]),
    health: z.enum(["healthy", "unhealthy"]).nullable(),
  })
  .strict();

export const workspaceInventoryOutput = z
  .object({
    workspace: z
      .object({
        rootPath: pathSchema,
        branch: branchSchema,
        devboxWorkspaceId: workspaceKeySchema.nullable(),
      })
      .strict()
      .nullable(),
    status: z.enum([
      "ready",
      "workspace_unavailable",
      "helper_missing",
      "inventory_unavailable",
      "not_indexed",
      "busy",
    ]),
    services: z
      .array(
        z
          .object({
            serviceId: serviceKeySchema,
            remotePort: portSchema,
            kind: z.enum(["http", "tcp"]),
          })
          .strict(),
      )
      .max(64),
    declaredServices: z.array(declaredServiceSchema).max(64),
  })
  .strict();

export type WorkspaceInventory = z.infer<typeof workspaceInventoryOutput>;
