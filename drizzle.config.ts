import { defineConfig } from "drizzle-kit";
import { resolvePostgresConnectionString } from "./lib/db/connection-string";

const url = resolvePostgresConnectionString();

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: url ? { url } : { url: "" },
  strict: true,
});
