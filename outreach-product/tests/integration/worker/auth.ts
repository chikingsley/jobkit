import { exports } from "cloudflare:workers";

const password = "integration-test-password";

export async function createAuthenticatedUser(email: string) {
  const response = await exports.default.fetch(
    "https://outreach.test/api/auth/sign-up/email",
    {
      body: JSON.stringify({ email, name: "Integration User", password }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error(`Test user could not sign up (${response.status})`);
  }
  const data = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie.includes("session_token")) {
    throw new Error("Test sign-up did not issue a session cookie");
  }
  return { cookie, userId: data.user.id };
}
