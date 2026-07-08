import { resolve } from "node:path";

import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: resolve(import.meta.dirname, "../../.env") });

const datasource = process.env.DATABASE_URL
  ? {
      url: process.env.DATABASE_URL
    }
  : undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource
});
