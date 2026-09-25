"use client";

import { useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type MentionCandidate = { id: string; displayName: string | null };

/**
 * A plain <textarea> or <input> with @mention autocomplete layered on
 * top — scoped to the caller's own accepted connections (never an open
 * search across every member), matching the same scope decision
 * SharePostButton already made for sharing. Typing "@" followed by
 * letters filters the list; picking one inserts "@DisplayName " as
 * literal text (no rich markup) and reports the connection's id via
 * onMentionedIdsChange, so the caller can call addMention() for each
 * once the post/comment is actually created — no server-side text
 * parsing needed, and no ambiguity if two connections share a name.
 *
 * Known simplification: deleting the "@Name " text afterward doesn't
 * un-track that id. Rare in practice (why type a mention then delete
 * it?) and not worth the extra bookkeeping this pass.
 */
export default function MentionInput({
  multiline = false,
  value,
  onChange,
  connections,
  onMentionedIdsChange,
  placeholder,
  disabled,
  className,
  maxLength,
  onKeyDown,
  rows,
}: {
  multiline?: boolean;
  value: string;
  onChange: (value: string) => void;
  connections: MentionCandidate[];
  onMentionedIdsChange?: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  rows?: number;
}) {
  const { t } = useLanguage();
  const elRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const mentionedIdsRef = useRef<Set<string>>(new Set());

  const matches =
    query === null
      ? []
      : connections.filter((c) => (c.displayName ?? "").toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  function detectMention(text: string, cursor: number) {
    // Find the nearest unescaped "@" walking back from the cursor,
    // stopping at whitespace (an in-progress mention has no spaces yet).
    let i = cursor - 1;
    while (i >= 0 && !/\s/.test(text[i])) {
      if (text[i] === "@") {
        setQuery(text.slice(i + 1, cursor));
        setMentionStart(i);
        return;
      }
      i--;
    }
    setQuery(null);
    setMentionStart(null);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) {
    const next = e.target.value;
    onChange(next);
    detectMention(next, e.target.selectionStart ?? next.length);
  }

  function pickMention(c: MentionCandidate) {
    if (mentionStart === null || query === null) return;
    const name = c.displayName ?? t("social.anonymousUser");
    const before = value.slice(0, mentionStart);
    const after = value.slice(mentionStart + 1 + query.length);
    const next = `${before}@${name} ${after}`;
    onChange(next);
    mentionedIdsRef.current.add(c.id);
    onMentionedIdsChange?.(Array.from(mentionedIdsRef.current));
    setQuery(null);
    setMentionStart(null);
    // Refocus after React re-renders with the new value.
    requestAnimationFrame(() => elRef.current?.focus());
  }

  const sharedProps = {
    ref: elRef,
    value,
    onChange: handleChange,
    placeholder,
    disabled,
    className,
    maxLength,
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (query !== null && e.key === "Escape") {
        setQuery(null);
        setMentionStart(null);
        return;
      }
      onKeyDown?.(e);
    },
  } as const;

  return (
    <div className="relative flex-1 min-w-0">
      {multiline ? <textarea {...sharedProps} rows={rows} /> : <input type="text" {...sharedProps} />}

      {query !== null && matches.length > 0 && (
        <div
          className="card"
          style={{
            position: "absolute",
            bottom: "calc(100% + 0.25rem)",
            left: 0,
            width: "200px",
            zIndex: 30,
            padding: "0.35rem",
          }}
        >
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickMention(c)}
              className="w-full text-left rounded-lg px-2 py-1.5 text-sm text-white/85 hover:bg-white/5 transition truncate"
            >
              @{c.displayName ?? t("social.anonymousUser")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
