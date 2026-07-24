export function isHonoRequest(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/openapi.json" ||
    pathname === "/googlebf69a7f0424212f5.html"
  );
}

export function applyDocumentCachePolicy(
  pathname: string,
  response: Response
): Response {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? "";
  const isPublicHtml =
    contentType.includes("text/html") &&
    !pathname.startsWith("/app/") &&
    pathname !== "/app";
  const isPublicSearchAsset =
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/sitemaps/");
  const isPublicResponse = isPublicHtml || isPublicSearchAsset;
  if (isPublicResponse) {
    headers.delete("set-cookie");
    removeVaryField(headers, "cookie");
  }
  let cacheControl = "private, no-store";
  if (isPublicSearchAsset) {
    cacheControl = "public, max-age=300, s-maxage=300";
  } else if (isPublicHtml) {
    cacheControl = "public, max-age=0, must-revalidate";
  }
  headers.set("cache-control", cacheControl);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function removeVaryField(headers: Headers, excludedField: string) {
  const vary = headers.get("vary");
  if (!vary) {
    return;
  }
  const retainedFields = vary
    .split(",")
    .map((field) => field.trim())
    .filter(
      (field) => field !== "" && field.toLocaleLowerCase("en") !== excludedField
    );
  if (retainedFields.length === 0) {
    headers.delete("vary");
    return;
  }
  headers.set("vary", retainedFields.join(", "));
}

interface RoutedWorkerHandlers<Env, QueueBody> {
  fetchHono: (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<Response> | Response;
  fetchStart: (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<Response> | Response;
  runQueue: (
    batch: MessageBatch<QueueBody>,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void> | void;
  runScheduled: (
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<void> | void;
}

export function createRoutedWorker<Env, QueueBody = unknown>(
  handlers: RoutedWorkerHandlers<Env, QueueBody>
) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const { pathname } = new URL(request.url);
      if (isHonoRequest(pathname)) {
        return handlers.fetchHono(request, env, ctx);
      }
      const response = await handlers.fetchStart(request, env, ctx);
      return applyDocumentCachePolicy(pathname, response);
    },
    queue(batch: MessageBatch<QueueBody>, env: Env, ctx: ExecutionContext) {
      return handlers.runQueue(batch, env, ctx);
    },
    scheduled(
      controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ) {
      return handlers.runScheduled(controller, env, ctx);
    },
  };
}
