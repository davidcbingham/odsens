/**
 * tests/helpers/mockFetch.ts — `mockFetch(routes)` (05 §1.3, H-5). Adapters take `fetch` by injection
 * (`lib/adapters/*` export `create<Adapter>({ fetch, env })`, 04 SC-25); unit tests never hit the
 * network. Real from S1.2 (05 §8).
 *
 * `routes` maps a URL to a `Response` or a `(req: Request) => Response` handler. A route key matches
 * when it equals the request URL, equals the URL without its query string, or is a prefix of the URL
 * (first matching key in insertion order wins). Static `Response` values are cloned per call so a
 * retrying caller can consume the body each time. An unrouted URL throws — no silent fall-through to
 * a real socket (H-5).
 */

export type MockRoute = Response | ((req: Request) => Response | Promise<Response>);
export type MockRoutes = Record<string, MockRoute>;

export const mockFetch: (routes: MockRoutes) => typeof fetch = (routes) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof URL ? input.href : input, init);
    const bare = request.url.split('?')[0];
    for (const [key, route] of Object.entries(routes)) {
      if (request.url === key || bare === key || request.url.startsWith(key)) {
        return route instanceof Response ? route.clone() : route(request);
      }
    }
    throw new Error(`mockFetch: no route for ${request.url} (H-5 — add it to the routes map)`);
  }) as typeof fetch;
