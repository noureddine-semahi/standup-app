"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listConnections,
  sendConnectionRequest,
  respondToConnectionRequest,
  removeConnection,
  connectionDisplayName,
  getPublicFeed,
  getMyReactionsForOwners,
  toISODate,
  type Connection,
  type PublicFeedEntry,
  type GlimpseReaction,
} from "@/lib/supabase/db";
import PublicFeedCard from "@/components/PublicFeedCard";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function SocialPage() {
  const { t } = useLanguage();
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connError, setConnError] = useState<string | null>(null);
  const [connEmail, setConnEmail] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [sendRequestMsg, setSendRequestMsg] = useState<string | null>(null);
  // Per-row busy tracking so accepting/declining/removing one row doesn't
  // block interaction with the others while its request is in flight.
  const [busyConnectionIds, setBusyConnectionIds] = useState<Set<string>>(new Set());

  const [feed, setFeed] = useState<PublicFeedEntry[]>([]);
  const [feedReactions, setFeedReactions] = useState<Record<string, GlimpseReaction>>({});
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);

  function refreshConnections() {
    return listConnections()
      .then(setConnections)
      .catch((e: any) => setConnError(e?.message ?? t("social.failedLoadConnections")));
  }

  function refreshFeed() {
    setFeedLoading(true);
    return getPublicFeed(todayISO)
      .then(async (entries) => {
        setFeed(entries);
        const ownerIds = entries.map((e) => e.ownerId);
        const reactions = await getMyReactionsForOwners(ownerIds, todayISO);
        setFeedReactions(reactions);
      })
      .catch((e: any) => setFeedError(e?.message ?? t("social.failedLoadFeed")))
      .finally(() => setFeedLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    refreshConnections().finally(() => setLoading(false));
    refreshFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setConnectionBusy(id: string, busy: boolean) {
    setBusyConnectionIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSendRequest() {
    const email = connEmail.trim();
    if (!email || sendingRequest) return;
    setSendingRequest(true);
    setConnError(null);
    setSendRequestMsg(null);
    try {
      await sendConnectionRequest(email);
      setConnEmail("");
      setSendRequestMsg(t("social.connectionRequestSent"));
      refreshConnections();
    } catch (e: any) {
      setConnError(e?.message ?? t("social.failedLoadConnections"));
    } finally {
      setSendingRequest(false);
    }
  }

  async function handleRespond(id: string, accept: boolean) {
    if (busyConnectionIds.has(id)) return;
    setConnectionBusy(id, true);
    setConnError(null);
    try {
      await respondToConnectionRequest(id, accept);
      refreshConnections();
    } catch (e: any) {
      setConnError(e?.message ?? t("social.failedRespondRequest"));
    } finally {
      setConnectionBusy(id, false);
    }
  }

  async function handleRemoveConnection(id: string) {
    if (busyConnectionIds.has(id)) return;
    setConnectionBusy(id, true);
    setConnError(null);
    try {
      await removeConnection(id);
      refreshConnections();
    } catch (e: any) {
      setConnError(e?.message ?? t("social.failedRemoveConnection"));
    } finally {
      setConnectionBusy(id, false);
    }
  }

  if (loading) {
    return <div className="card">{t("dashboard.loading")}</div>;
  }

  const incoming = connections.filter((c) => c.status === "pending" && c.direction === "incoming");
  const outgoing = connections.filter((c) => c.status === "pending" && c.direction === "outgoing");
  const accepted = connections.filter((c) => c.status === "accepted");

  return (
    <div className="card card-highlight">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("social.title")}</h1>
        <p className="text-white/70">{t("social.subtitle")}</p>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{ background: "rgba(var(--tint-rgb), 0.03)", border: "1px solid rgba(var(--tint-rgb), 0.08)" }}
      >
        <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
          {t("social.connectionsTitle")}
        </div>
        <p className="text-xs text-white/60 mb-3">{t("social.connectionsBody")}</p>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={connEmail}
            onChange={(e) => setConnEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSendRequest();
              }
            }}
            placeholder={t("social.connectionEmailPlaceholder")}
            disabled={sendingRequest}
            className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSendRequest}
            disabled={sendingRequest || !connEmail.trim()}
            className="btn btn-primary text-sm px-4 py-2 whitespace-nowrap"
          >
            {sendingRequest ? t("social.sendingRequest") : t("social.sendRequest")}
          </button>
        </div>
        {sendRequestMsg && <p className="mt-2 text-xs text-emerald-300">{sendRequestMsg}</p>}
        {connError && <p className="mt-2 text-xs text-red-300">{connError}</p>}

        <div className="mt-4 space-y-4">
          {incoming.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                {t("social.incomingRequests")}
              </div>
              <div className="space-y-1.5">
                {incoming.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-sm text-white/85 truncate">{connectionDisplayName(c)}</span>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRespond(c.id, true)}
                        disabled={busyConnectionIds.has(c.id)}
                        className="btn"
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                      >
                        {t("social.accept")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespond(c.id, false)}
                        disabled={busyConnectionIds.has(c.id)}
                        className="btn"
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                      >
                        {t("social.decline")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {outgoing.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                {t("social.outgoingRequests")}
              </div>
              <div className="space-y-1.5">
                {outgoing.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-sm text-white/85 truncate">{connectionDisplayName(c)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveConnection(c.id)}
                      disabled={busyConnectionIds.has(c.id)}
                      className="btn flex-shrink-0"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("social.cancelRequest")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
              {t("social.yourConnections")}
            </div>
            {accepted.length === 0 ? (
              <p className="text-xs text-white/40 italic">{t("social.noConnectionsYet")}</p>
            ) : (
              <div className="space-y-1.5">
                {accepted.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-sm text-white/85 truncate">{connectionDisplayName(c)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveConnection(c.id)}
                      disabled={busyConnectionIds.has(c.id)}
                      className="btn flex-shrink-0"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                    >
                      {t("social.removeConnection")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Public Feed — every "Everyone"-visibility post today, from any
          user, not just accepted connections. */}
      <div className="mt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{t("social.publicFeedTitle")}</h2>
          <p className="mt-1 text-sm text-white/60">{t("social.publicFeedSubtitle")}</p>
        </div>
        {feedError && <p className="mb-3 text-xs text-red-300">{feedError}</p>}
        {!feedLoading && feed.length === 0 ? (
          <p className="text-sm text-white/50">{t("social.noPublicPostsToday")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {feed.map((entry) => (
              <PublicFeedCard
                key={entry.ownerId}
                ownerId={entry.ownerId}
                displayName={entry.displayName ?? t("social.anonymousUser")}
                goals={entry.goals}
                planDateISO={todayISO}
                initialReaction={feedReactions[entry.ownerId] ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
