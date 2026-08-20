/**
 * tests/helpers/mockFetch.ts — `mockFetch(routes)` (05 §1.3, H-5). Adapters take `fetch` by injection
 * (`lib/adapters/*` export `create<Adapter>({ fetch, env })`, 04 SC-25); unit tests never hit the network.
 * Real implementation lands in S1.2 (05 §8); at S0 this is a typed stub.
 */

export type MockRoute = Response | ((req: Request) => Response | Promise<Response>);
export type MockRoutes = Record<string, MockRoute>;

export const mockFetch: (routes: MockRoutes) => typeof fetch = () => {
  throw new Error('mockFetch: available from S1.2');
};
