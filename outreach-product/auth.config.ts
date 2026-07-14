import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { authOptions } from "./worker/auth";

export const auth = betterAuth({
  ...authOptions,
  database: new DatabaseSync(":memory:"),
});
