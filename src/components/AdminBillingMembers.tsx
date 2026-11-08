"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { supabase } from "@/lib/supabase/client";
import { getBillingMembers, setMemberPremium, type MembersPage } from "@/lib/admin/billingAdminClient";
import { MEMBER_FLAG_FILTERS, MEMBER_PLAN_FILTERS, PAGE_SIZES, DEFAULT_PAGE_SIZE, MAX_SEARCH_LENGTH, type MemberFlagFilter, type MemberPlanFilter, type MemberRow } from "@/lib/admin/memberBilling";

// Admin > Premium & Billing > Member billing. The SERVER authorises every call (System Admin only); this is the table and the manual grant/revoke buttons.
// A grant/revoke goes through the existing admin_set_entitlement function (via /api/admin/billing-premium). There is no control here that touches Stripe.

const deps = { getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null };
type Phase = "loading" | "ready" | "error";
type Pending = { member: MemberRow; action: "grant" | "revoke" };
const STATUS_KEYS = ["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"];

export default function AdminBillingMembers({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { t, language } = useLanguage();
  const locale = language === "es" ? "es" : "en";
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [plan, setPlan] = useState<MemberPlanFilter>("all");
  const [filter, setFilter] = useState<MemberFlagFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<MembersPage | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);

  // debounce the search box so every keystroke doesn't call the server
  useEffect(() => {
    const id = setTimeout(() => {
      setApplied((prev) => (prev === search.trim() ? prev : search.trim()));
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const mine = ++seq.current;
    (async () => {
      setPhase("loading");
      const r = await getBillingMembers({ search: applied, plan, filter, page, pageSize }, deps);
      if (mine !== seq.current) return;
      if (r.kind === "ok") {
        setData(r.data);
        setPhase("ready");
        if (r.data.page !== page) setPage(r.data.page);
      } else if (r.kind === "login" || r.kind === "forbidden") {
        unauthorizedRef.current?.();
        setPhase("error");
      } else setPhase("error");
    })();
  }, [applied, plan, filter, page, pageSize, reload]);

  const fmt = (iso: string | null, dateOnly = false) => {
    if (!iso) return t("adminBillOps.dash");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t("adminBillOps.dash");
    return new Intl.DateTimeFormat(locale, dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  const who = (m: MemberRow) => m.email ?? m.displayName ?? m.id;
  const statusText = (s: string | null) => (s === null ? t("adminBillOps.status.none") : STATUS_KEYS.includes(s) ? t(`adminBillOps.status.${s}` as "adminBillOps.status.active") : t("adminBillOps.status.unknown"));

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const r = await setMemberPremium(pending.member.id, pending.action, deps);
    setBusy(false);
    const name = who(pending.member);
    const done = pending.action;
    setPending(null);
    if (r.kind === "ok") {
      setNotice({ tone: "ok", text: t(done === "grant" ? "adminBillOps.done.granted" : "adminBillOps.done.revoked", { member: name }) });
      setReload((n) => n + 1);
    } else if (r.kind === "refused") {
      const key = r.code === "deletion_pending" ? "adminBillOps.err.deletion_pending" : r.code === "not_found" ? "adminBillOps.err.not_found" : "adminBillOps.err.change_failed";
      setNotice({ tone: "bad", text: t(key) });
      if (r.code === "deletion_pending" || r.code === "not_found") setReload((n) => n + 1);
    } else if (r.kind === "forbidden" || r.kind === "login") {
      setNotice({ tone: "bad", text: t("adminBillOps.err.forbidden") });
    } else setNotice({ tone: "bad", text: t("adminBillOps.err.change_failed") });
  }

  const items = data?.items ?? [];
  const select = "rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm min-h-[44px] w-full";

  return (
    <section className="card space-y-4" data-testid="adminops-members" aria-labelledby="adminops-members-title">
      <div>
        <h2 id="adminops-members-title" className="text-lg font-semibold">{t("adminBillOps.members.title")}</h2>
        <p className="text-sm text-white/60 mt-1">{t("adminBillOps.members.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm sm:col-span-2">
          <span className="text-white/70">{t("adminBillOps.members.searchLabel")}</span>
          <input
            type="search"
            value={search}
            maxLength={MAX_SEARCH_LENGTH}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("adminBillOps.members.searchPlaceholder")}
            className={`${select} mt-1`}
            data-testid="adminops-search"
          />
        </label>
        <label className="block text-sm">
          <span className="text-white/70">{t("adminBillOps.members.planFilter")}</span>
          <select value={plan} onChange={(e) => { setPlan(e.target.value as MemberPlanFilter); setPage(1); }} className={`${select} mt-1`} data-testid="adminops-plan">
            {MEMBER_PLAN_FILTERS.map((p) => (
              <option key={p} value={p} className="text-black">{t(`adminBillOps.plan.${p}` as "adminBillOps.plan.all")}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-white/70">{t("adminBillOps.members.flagFilter")}</span>
          <select value={filter} onChange={(e) => { setFilter(e.target.value as MemberFlagFilter); setPage(1); }} className={`${select} mt-1`} data-testid="adminops-flag">
            {MEMBER_FLAG_FILTERS.map((f) => (
              <option key={f} value={f} className="text-black">{t(`adminBillOps.flag.${f}` as "adminBillOps.flag.all")}</option>
            ))}
          </select>
        </label>
      </div>

      {notice && (
        <p role="status" className={`text-sm ${notice.tone === "ok" ? "text-emerald-300" : "text-red-300"}`} data-testid="adminops-notice">{notice.text}</p>
      )}

      {phase === "loading" && <p className="text-sm text-white/50" role="status" data-testid="adminops-members-loading">{t("adminBillOps.members.loading")}</p>}
      {phase === "error" && (
        <p className="text-sm text-red-300" role="alert" data-testid="adminops-members-error">
          {t("adminBillOps.members.error")}{" "}
          <button type="button" className="underline" onClick={() => setReload((n) => n + 1)} data-testid="adminops-members-retry">{t("premium.retry")}</button>
        </p>
      )}
      {phase === "ready" && items.length === 0 && <p className="text-sm text-white/60" data-testid="adminops-members-empty">{t("adminBillOps.members.empty")}</p>}

      {phase === "ready" && items.length > 0 && (
        <ul className="space-y-3" data-testid="adminops-member-list">
          {items.map((m) => (
            <li key={m.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2" data-testid="adminops-member">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-all">{m.email ?? t("adminBillOps.dash")}</p>
                  <p className="text-xs text-white/50 break-all">{m.displayName ?? t("adminBillOps.members.unnamed")}</p>
                </div>
                <span className="text-xs rounded-full bg-white/10 px-2.5 py-1" data-testid="adminops-plan-badge">{t(`adminBillOps.plan.${m.plan}` as "adminBillOps.plan.free")}</span>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-white/50 text-xs">{t("adminBillOps.col.source")}</dt><dd data-testid="adminops-source">{t(`adminBillOps.source.${m.source}` as "adminBillOps.source.none")}{m.alsoStripe ? ` (${t("adminBillOps.alsoStripe")})` : ""}</dd></div>
                <div><dt className="text-white/50 text-xs">{t("adminBillOps.col.stripe")}</dt><dd data-testid="adminops-stripe">{statusText(m.stripeStatus)}</dd></div>
                <div><dt className="text-white/50 text-xs">{t("adminBillOps.col.cancels")}</dt><dd data-testid="adminops-cancels">{fmt(m.scheduledCancellationAt, true)}</dd></div>
                <div><dt className="text-white/50 text-xs">{t("adminBillOps.col.sync")}</dt><dd data-testid="adminops-sync">{m.stripeStatus === null ? t("adminBillOps.dash") : m.lastSyncAt ? fmt(m.lastSyncAt) : t("adminBillOps.never")}</dd></div>
                <div><dt className="text-white/50 text-xs">{t("adminBillOps.col.deletion")}</dt><dd data-testid="adminops-deletion">{m.deletionPending ? t(`adminBillOps.deletion.${m.deletionPending}` as "adminBillOps.deletion.pending") : t("adminBillOps.dash")}</dd></div>
              </dl>
              <div>
                {m.manualGrant ? (
                  <button type="button" className="btn-secondary min-h-[44px] px-4 text-sm" onClick={() => setPending({ member: m, action: "revoke" })} data-testid="adminops-revoke">{t("adminBillOps.action.revoke")}</button>
                ) : m.deletionPending ? (
                  <p className="text-xs text-amber-300" data-testid="adminops-blocked">{t("adminBillOps.action.blocked")}</p>
                ) : (
                  <button type="button" className="btn-secondary min-h-[44px] px-4 text-sm" onClick={() => setPending({ member: m, action: "grant" })} data-testid="adminops-grant">{t("adminBillOps.action.grant")}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/70">
          <span data-testid="adminops-total">{t("adminBillOps.members.total", { count: new Intl.NumberFormat(locale).format(data.total) })}</span>
          <label className="flex items-center gap-2">
            <span>{t("adminBillOps.members.pageSize")}</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-lg bg-white/10 border border-white/15 px-2 py-2 min-h-[44px]" data-testid="adminops-pagesize">
              {PAGE_SIZES.map((s) => (<option key={s} value={s} className="text-black">{s}</option>))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary min-h-[44px] px-3" disabled={data.page <= 1 || phase === "loading"} onClick={() => setPage(data.page - 1)} data-testid="adminops-prev">{t("adminBillOps.members.prev")}</button>
            <span data-testid="adminops-pageof">{t("adminBillOps.members.pageOf", { page: data.page, pages: data.pages })}</span>
            <button type="button" className="btn-secondary min-h-[44px] px-3" disabled={data.page >= data.pages || phase === "loading"} onClick={() => setPage(data.page + 1)} data-testid="adminops-next">{t("adminBillOps.members.next")}</button>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="adminops-confirm-title" data-testid="adminops-confirm">
          <div className="card max-w-md w-full space-y-3">
            <h3 id="adminops-confirm-title" className="text-lg font-semibold">{t(pending.action === "grant" ? "adminBillOps.confirm.grantTitle" : "adminBillOps.confirm.revokeTitle")}</h3>
            <p className="text-sm text-white/70">{t(pending.action === "grant" ? "adminBillOps.confirm.grantBody" : "adminBillOps.confirm.revokeBody", { member: who(pending.member) })}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary min-h-[44px] px-4" disabled={busy} onClick={() => setPending(null)} data-testid="adminops-cancel">{t("adminBillOps.confirm.cancel")}</button>
              <button type="button" className="btn-primary min-h-[44px] px-4" disabled={busy} onClick={() => void confirm()} data-testid="adminops-confirm-go">{busy ? t("adminBillOps.confirm.busy") : t(pending.action === "grant" ? "adminBillOps.confirm.grant" : "adminBillOps.confirm.revoke")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export type { MembersPage };
