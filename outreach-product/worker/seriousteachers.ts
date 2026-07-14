import { parse } from "node-html-parser";
import type { AppEnv } from "./env";

interface Session {
  cookie: string;
}

export interface ApplicationSubmissionResult {
  appliedDate: string;
  submittedNow: boolean;
}

const MAX_HTML_BYTES = 1_500_000;
const SERIOUS_TEACHERS_ORIGIN = "https://www.seriousteachers.com";
const browserHeaders = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
};

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

function addResponseCookies(jar: Map<string, string>, response: Response) {
  const values = response.headers.getSetCookie();
  const setCookies = values.length
    ? values
    : [response.headers.get("set-cookie")].filter((value): value is string =>
        Boolean(value)
      );
  for (const value of setCookies) {
    const pair = value.split(";", 1)[0]?.trim();
    const separator = pair?.indexOf("=") ?? -1;
    if (pair && separator > 0) {
      jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function login(env: AppEnv): Promise<Session> {
  if (!(env.SERIOUSTEACHERS_EMAIL && env.SERIOUSTEACHERS_PASSWORD)) {
    throw new Error("Serious Teachers credentials are not configured");
  }
  const loginUrl = `${SERIOUS_TEACHERS_ORIGIN}/te2/login`;
  const first = await fetch(loginUrl, {
    headers: browserHeaders,
    redirect: "manual",
  });
  if (!first.ok) {
    throw new Error(`Serious Teachers login page returned ${first.status}`);
  }
  const html = await boundedHtml(first);
  const token = parse(html)
    .querySelector('input[name="__RequestVerificationToken"]')
    ?.getAttribute("value");
  if (!token) {
    throw new Error("Serious Teachers login token was missing");
  }
  const cookies = new Map<string, string>();
  addResponseCookies(cookies, first);
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    email: env.SERIOUSTEACHERS_EMAIL,
    idemployer: "0",
    idjob: "0",
    password: env.SERIOUSTEACHERS_PASSWORD,
  });
  const response = await fetch(loginUrl, {
    body: form,
    headers: {
      ...browserHeaders,
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(cookies),
      origin: SERIOUS_TEACHERS_ORIGIN,
      referer: loginUrl,
    },
    method: "POST",
    redirect: "manual",
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`Serious Teachers login failed (${response.status})`);
  }
  addResponseCookies(cookies, response);
  return {
    cookie: cookieHeader(cookies),
  };
}

export async function submitApplication(
  env: AppEnv,
  applyUrl: string,
  message: string
): Promise<ApplicationSubmissionResult> {
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
    return { appliedDate: existing, submittedNow: false };
  }
  const formPage = await fetch(applyUrl, {
    headers: { ...browserHeaders, cookie: session.cookie },
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
      ...browserHeaders,
      "content-type": "application/x-www-form-urlencoded",
      cookie: session.cookie,
      origin: SERIOUS_TEACHERS_ORIGIN,
      referer: applyUrl,
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
  return { appliedDate: verified, submittedNow: true };
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
      { headers: { ...browserHeaders, cookie: session.cookie } }
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
