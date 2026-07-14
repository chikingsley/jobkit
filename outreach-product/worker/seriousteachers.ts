import { parse } from "node-html-parser";
import type { AppEnv } from "./env";

interface Session {
  cookie: string;
}

const MAX_HTML_BYTES = 1_500_000;

async function boundedHtml(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_HTML_BYTES) {
    throw new Error(
      `Serious Teachers response exceeded ${MAX_HTML_BYTES} bytes`
    );
  }
  const text = await response.text();
  if (text.length > MAX_HTML_BYTES) {
    throw new Error(
      `Serious Teachers response exceeded ${MAX_HTML_BYTES} characters`
    );
  }
  return text;
}

function cookiePart(value: string | null): string {
  return (
    value
      ?.split(",")
      .map((part) => part.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ") ?? ""
  );
}

export async function login(env: AppEnv): Promise<Session> {
  if (!(env.SERIOUSTEACHERS_EMAIL && env.SERIOUSTEACHERS_PASSWORD)) {
    throw new Error("Serious Teachers credentials are not configured");
  }
  const first = await fetch("https://www.seriousteachers.com/te2/login", {
    redirect: "manual",
  });
  const html = await boundedHtml(first);
  const token = parse(html)
    .querySelector('input[name="__RequestVerificationToken"]')
    ?.getAttribute("value");
  if (!token) {
    throw new Error("Serious Teachers login token was missing");
  }
  const initialCookie = cookiePart(first.headers.get("set-cookie"));
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    email: env.SERIOUSTEACHERS_EMAIL,
    idemployer: "0",
    idjob: "0",
    password: env.SERIOUSTEACHERS_PASSWORD,
  });
  const response = await fetch("https://www.seriousteachers.com/te2/login", {
    body: form,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: initialCookie,
    },
    method: "POST",
    redirect: "manual",
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`Serious Teachers login failed (${response.status})`);
  }
  return {
    cookie: [initialCookie, cookiePart(response.headers.get("set-cookie"))]
      .filter(Boolean)
      .join("; "),
  };
}

export async function submitApplication(
  env: AppEnv,
  applyUrl: string,
  message: string
): Promise<string> {
  const session = await login(env);
  const match = /\/te2\/respond\/(\d+)\/(\d+)/.exec(applyUrl);
  if (!(match?.[1] && match[2])) {
    throw new Error(
      "Application URL did not contain job and employer identifiers"
    );
  }
  const [, jobId, employerId] = match;
  const existing = await appliedDate(session, jobId, employerId);
  if (existing) {
    throw new Error(
      `Serious Teachers already shows this job as applied on ${existing}`
    );
  }
  const formPage = await fetch(applyUrl, {
    headers: { cookie: session.cookie },
  });
  if (!formPage.ok) {
    throw new Error(`Application form returned ${formPage.status}`);
  }
  const document = parse(await boundedHtml(formPage));
  const token = document
    .querySelector('input[name="__RequestVerificationToken"]')
    ?.getAttribute("value");
  if (!token) {
    throw new Error("Application form token was missing");
  }
  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    Comments: message,
    "Teacher.Abroad":
      document
        .querySelector('input[name="Teacher.Abroad"]')
        ?.getAttribute("value") ?? "",
    "Teacher.euteacher":
      document
        .querySelector('input[name="Teacher.euteacher"]')
        ?.getAttribute("value") ?? "",
  });
  const response = await fetch(applyUrl, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: session.cookie,
    },
    method: "POST",
    redirect: "manual",
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`Application submission returned ${response.status}`);
  }
  const verified = await appliedDate(session, jobId, employerId);
  if (!verified) {
    throw new Error(
      "Serious Teachers accepted the POST but did not show a last-applied record"
    );
  }
  return verified;
}

async function appliedDate(
  session: Session,
  jobId: string,
  employerId: string
): Promise<string | null> {
  const target = `#_${jobId}${employerId}`;
  for (const page of [0, 1]) {
    const response = await fetch(
      `https://www.seriousteachers.com/te2/seriousteachers_panel/${page}/0/0`,
      { headers: { cookie: session.cookie } }
    );
    if (!response.ok) {
      throw new Error(`Private-board verification returned ${response.status}`);
    }
    const document = parse(await boundedHtml(response));
    const button = document.querySelector(`[data-bs-target="${target}"]`);
    const text = button?.text.trim() ?? "";
    const date = /last applied on\s+(.+)/i.exec(text)?.[1]?.trim();
    if (date) {
      return date;
    }
  }
  return null;
}
