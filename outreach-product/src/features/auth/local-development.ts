export const localDevelopmentAuthEnabled =
  import.meta.env.MODE === "development";

export const localDevelopmentUser = {
  email: "local@jobkit.test",
  id: "local-development-user",
  name: "Local JobKit User",
  role: "operator",
} as const;
