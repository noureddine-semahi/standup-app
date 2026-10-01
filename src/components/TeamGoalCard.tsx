"use client";

import { useState } from "react";
import { Check, Square, UserPlus, Users } from "lucide-react";
import { useTeamGoalCard } from "@/lib/teamGoals";
import type { Post } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * The team_goal branch of a feed post — a shared checklist any participant
 * can add to or check off, open to anyone who can see the post via a Join
 * button. Owns its own join/toggle/add state via useTeamGoalCard so
 * PostCard itself stays a thin per-type switch, matching how reactions
 * are already handled with usePostReaction.
 */
export default function TeamGoalCard({ post }: { post: Post }) {
  const { t } = useLanguage();
  const [newItemText, setNewItemText] = useState("");
  const { joined, items, participantCount, status, joining, addingItem, togglingIds, error, join, toggleItem, addItem } =
    useTeamGoalCard({
      teamGoalId: post.teamGoalId as string,
      initialJoined: post.teamGoalJoined ?? false,
      initialItems: post.teamGoalItems ?? [],
      initialParticipantCount: post.teamGoalParticipantCount ?? 0,
      initialStatus: post.teamGoalStatus ?? "open",
    });

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-sm font-semibold text-white">{post.teamGoalTitle}</div>
        {status === "completed" && <span className="text-xs font-semibold text-emerald-400">{t("teamGoal.completed")}</span>}
      </div>
      {post.teamGoalDetails && <p className="text-xs text-white/60 mb-2">{post.teamGoalDetails}</p>}

      <div className="flex items-center gap-2 text-xs text-white/50 mb-2">
        <Users size={12} /> {t("teamGoal.participantCount", { count: participantCount })}
        {total > 0 && <span>· {t("teamGoal.progress", { done: doneCount, total })}</span>}
      </div>

      {total > 0 && (
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-3">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: status === "completed" ? "#34d399" : "#f59e0b" }}
          />
        </div>
      )}

      {total > 0 && (
        <div className="space-y-1 mb-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!joined || togglingIds.has(item.id)}
              onClick={() => toggleItem(item.id, !item.done)}
              className="w-full flex items-center gap-2 text-left text-xs disabled:cursor-default"
              style={{ opacity: togglingIds.has(item.id) ? 0.5 : 1 }}
              title={!joined ? t("teamGoal.joinToEdit") : undefined}
            >
              {item.done ? (
                <Check size={14} className="flex-shrink-0 text-emerald-400" />
              ) : (
                <Square size={14} className="flex-shrink-0 text-white/30" />
              )}
              <span className={item.done ? "text-white/40 line-through" : "text-white/80"}>{item.text}</span>
            </button>
          ))}
        </div>
      )}

      {joined && status === "open" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newItemText.trim() || addingItem) return;
            addItem(newItemText);
            setNewItemText("");
          }}
          className="flex items-center gap-2 mb-2"
        >
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            disabled={addingItem}
            placeholder={t("teamGoal.addItemPlaceholder")}
            className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={addingItem || !newItemText.trim()}
            className="btn flex-shrink-0"
            style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem" }}
          >
            {addingItem ? t("teamGoal.adding") : t("teamGoal.addItemButton")}
          </button>
        </form>
      )}

      {!joined && status === "open" && (
        <button
          type="button"
          onClick={join}
          disabled={joining}
          className="btn btn-primary inline-flex items-center gap-1.5"
          style={{ padding: "0.3rem 0.7rem", fontSize: "0.75rem" }}
        >
          <UserPlus size={13} /> {joining ? t("teamGoal.joining") : t("teamGoal.joinButton")}
        </button>
      )}

      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
