import { createServer } from "node:http";
import { Readable } from "node:stream";
import { parseOptions } from "../options.js";

export async function handleProxy(args) {
  const options = parseOptions(args);
  const port = Number(options.port ?? 8787);
  const host = options.host ?? "127.0.0.1";

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be a valid TCP port.");
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    const target = requestUrl.searchParams.get("url");

    if (!target) {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("SliceDrop CLI proxy. Use /?url=<encoded-url>.");
      return;
    }

    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        "Access-Control-Allow-Origin": "*",
        Allow: "GET, HEAD, OPTIONS",
      });
      response.end();
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      response.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Invalid target URL.");
      return;
    }

    if (parsedTarget.protocol !== "https:") {
      response.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Only https targets are allowed.");
      return;
    }

    try {
      const headers = {};
      for (const name of ["accept", "range", "if-none-match", "if-modified-since"]) {
        const value = request.headers[name];
        if (value) {
          headers[name] = Array.isArray(value) ? value.join(", ") : value;
        }
      }

      const upstream = await fetch(parsedTarget, {
        headers,
        method: request.method,
        redirect: "follow",
      });

      const responseHeaders = corsProxyHeaders(upstream.headers);
      response.writeHead(upstream.status, upstream.statusText, responseHeaders);

      if (request.method === "HEAD" || !upstream.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstream.body).pipe(response);
    } catch (error) {
      response.writeHead(502, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(`Proxy error: ${error.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`SliceDrop CLI proxy listening at http://${host}:${port}/`);
  console.log("Press Ctrl+C to stop it.");
}

function writeCorsPreflight(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, If-None-Match, If-Modified-Since",
    "Access-Control-Max-Age": "86400",
  });
  response.end();
}

function corsProxyHeaders(upstreamHeaders) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, If-None-Match, If-Modified-Since",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
  };

  for (const name of [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ]) {
    const value = upstreamHeaders.get(name);
    if (value) {
      headers[name] = value;
    }
  }

  return headers;
}
