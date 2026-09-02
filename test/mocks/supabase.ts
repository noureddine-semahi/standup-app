import { vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

/**
 * Minimal chainable stub of the supabase-js client surface this app actually
 * uses (auth + from + rpc). Every query-builder method returns `this` so
 * calls can be chained in any order/combination, and the chain is thenable
 * so `await supabase.from(...).select(...).eq(...)` resolves to whatever
 * `data/error` the test configured via `queryResult`.
 */
export function createSupabaseMock() {
  let queryResult: QueryResult = { data: null, error: null };

  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(queryResult)),
    maybeSingle: vi.fn(() => Promise.resolve(queryResult)),
    then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(queryResult).then(resolve, reject),
  };

  const supabase = {
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signInWithOtp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signUp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    },
    from: vi.fn(() => builder),
    rpc: vi.fn(() => Promise.resolve(queryResult)),
    __setQueryResult: (result: QueryResult) => {
      queryResult = result;
    },
  };

  return supabase;
}
