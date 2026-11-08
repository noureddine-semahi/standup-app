import "server-only";
import { createClient } from "@supabase/supabase-js";
import { resolveTrustedOrigin } from "@/lib/billing/origins";

// The one System Admin check for the admin billing endpoints, so every one of them authorises in the same order and the same way, on the SERVER:
//   trusted Origin  ->  a valid Supabase sign-in  ->  the database's own is_sys_admin(), run AS the caller (with their token).
// Nothing is read for anyone who fails a step: a signed-out caller gets 401, a signed-in member who isn't a System Admin gets 403, and an ordinary
// Admin (not a System Admin) gets 403 too. The page's own check is only a courtesy that hides the screen.

export type GuardDeps = {
  env: Readonly<Record<string, string | undefined>>;
  authenticate(accessToken: string): Promise<{ id: string } | null>;
  isSysAdmin(accessToken: string): Promise<boolean>;
};

export type GuardResult = { ok: true; token: string; adminId: string } | { ok: false; response: Response };

export const adminJson = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const bearer = (header: string | null): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
};

/** Asks the database whether THIS token's owner is a System Admin (is_sys_admin runs as the caller). Any failure is "no". */
export async function isSysAdminViaDatabase(accessToken: string): Promise<boolean> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return false;
    const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data, error } = await supabase.rpc("is_sys_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function requireSysAdmin(req: Request, deps: GuardDeps): Promise<GuardResult> {
  if (!resolveTrustedOrigin(req.headers.get("origin"), deps.env)) return { ok: false, response: adminJson({ error: "forbidden_origin" }, 403) };
  const token = bearer(req.headers.get("authorization"));
  if (!token) return { ok: false, response: adminJson({ error: "unauthenticated" }, 401) };
  const user = await deps.authenticate(token).catch(() => null);
  if (!user) return { ok: false, response: adminJson({ error: "unauthenticated" }, 401) };
  const allowed = await deps.isSysAdmin(token).catch(() => false);
  if (!allowed) return { ok: false, response: adminJson({ error: "forbidden" }, 403) };
  return { ok: true, token, adminId: user.id };
}
