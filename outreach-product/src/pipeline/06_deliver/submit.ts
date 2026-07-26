const ORIGIN = "https://www.seriousteachers.com";
const LOGIN_PATH = "/te2/login";
const RESPOND_PATH = "/te2/respond";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const TOKEN_PATTERN = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/u;
const SUCCESS_PATTERN = /Application Submitted Successfully/iu;
const ALREADY_PATTERN = /already applied|already responded/iu;

export interface Credentials {
  email: string;
  password: string;
}

export interface SubmitRequest {
  comments: string;
  employerId: string;
  jobId: string;
  locatedIn?: string;
}

export type SubmitOutcome =
  | { detail: string; status: "failed" }
  | { status: "already-applied" }
  | { status: "submitted"; url: string };

class Session {
  readonly #cookies = new Map<string, string>();

  header() {
    return [...this.#cookies]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  absorb(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (pair && index > 0) {
        this.#cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${ORIGIN}${path}`, {
      ...init,
      headers: {
        "user-agent": USER_AGENT,
        ...(this.header() ? { cookie: this.header() } : {}),
        ...init.headers,
      },
      redirect: "manual",
    });
    this.absorb(response);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        return this.fetch(
          location.startsWith("http")
            ? new URL(location).pathname + new URL(location).search
            : location
        );
      }
    }
    return response;
  }
}

function tokenFrom(html: string) {
  const found = TOKEN_PATTERN.exec(html);
  if (!found?.[1]) {
    throw new Error("no anti-forgery token on page");
  }
  return found[1];
}

export async function submitApplication(
  credentials: Credentials,
  request: SubmitRequest
): Promise<SubmitOutcome> {
  const session = new Session();
  const applyPath = `${RESPOND_PATH}/${request.jobId}/${request.employerId}`;

  const loginPage = await session.fetch(
    `${LOGIN_PATH}/${request.jobId}/${request.employerId}`
  );
  const loginBody = new URLSearchParams({
    __RequestVerificationToken: tokenFrom(await loginPage.text()),
    email: credentials.email,
    idemployer: request.employerId,
    idjob: request.jobId,
    password: credentials.password,
  });
  const afterLogin = await session.fetch(LOGIN_PATH, {
    body: loginBody,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const afterLoginHtml = await afterLogin.text();
  if (afterLoginHtml.includes('type="password"')) {
    return { detail: "login rejected", status: "failed" };
  }

  const form = await session.fetch(applyPath);
  const formHtml = await form.text();
  if (ALREADY_PATTERN.test(formHtml)) {
    return { status: "already-applied" };
  }
  if (!formHtml.includes('name="Comments"')) {
    return { detail: "no application form on page", status: "failed" };
  }

  const submitBody = new URLSearchParams({
    __RequestVerificationToken: tokenFrom(formHtml),
    Comments: request.comments,
    locatedin: request.locatedIn ?? "United States of America",
    "Teacher.Abroad": "",
    "Teacher.euteacher": "1",
  });
  const sent = await session.fetch(applyPath, {
    body: submitBody,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: `${ORIGIN}${applyPath}`,
    },
    method: "POST",
  });
  const sentHtml = await sent.text();
  if (SUCCESS_PATTERN.test(sentHtml)) {
    return { status: "submitted", url: sent.url };
  }
  if (ALREADY_PATTERN.test(sentHtml)) {
    return { status: "already-applied" };
  }
  return {
    detail: `no confirmation banner (${sent.status})`,
    status: "failed",
  };
}
