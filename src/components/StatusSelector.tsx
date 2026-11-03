"use client";

import { useEffect, useRef } from "react";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Circle,
  Diamond,
  MinusCircle,
  Settings2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { GoalStatus } from "@/lib/supabase/db";
import type { TranslationKey } from "@/lib/i18n/en";

export type StatusAction = GoalStatus | "reschedule";

type Option = {
  action: StatusAction;
  tone: string;
  icon: LucideIcon;
  labelKey: TranslationKey;
};

// Row-major, two columns: Pending | Completed, In Progress | Attempted,
// Blocked | Missed, Rescheduled | Canceled.
export const STATUS_SELECTOR_OPTIONS: readonly Option[] = [
  { action: "not_started", tone: "not-started", icon: Circle, labelKey: "today.pendingAction" },
  { action: "completed", tone: "completed", icon: CheckCircle2, labelKey: "status.completed" },
  { action: "in_progress", tone: "in-progress", icon: Settings2, labelKey: "today.inProgressAction" },
  { action: "attempted", tone: "attempted", icon: Diamond, labelKey: "status.attempted" },
  { action: "blocked", tone: "blocked", icon: Ban, labelKey: "status.blocked" },
  { action: "missed", tone: "missed", icon: MinusCircle, labelKey: "status.missed" },
  { action: "reschedule", tone: "postponed", icon: CalendarClock, labelKey: "status.rescheduled" },
  { action: "canceled", tone: "canceled", icon: XCircle, labelKey: "status.canceled" },
];

/** Marks the element that opens/closes the selector, so a tap on it is the
 * trigger's own business rather than an "outside" tap. */
export const STATUS_TRIGGER_ATTR = "data-status-trigger";

type Props = {
  status: GoalStatus;
  /** Already-formatted reschedule target (e.g. "Nov 4"); set when the goal has one. */
  rescheduledLabel?: string | null;
  disabled?: boolean;
  onSelect: (action: StatusAction) => void;
  onClose: () => void;
};

/**
 * Compact two-column metallic status selector. Rendered inline (never an
 * overlay) only while open. It never changes a status on its own: opening,
 * closing, tapping outside and Escape all just close it; only choosing an
 * option calls onSelect.
 */
export default function StatusSelector({ status, rescheduledLabel, disabled, onSelect, onClose }: Props) {
  const { t } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (target.closest(`[${STATUS_TRIGGER_ATTR}]`)) return;
      closeRef.current();
      // The tap that dismisses must not also activate whatever is under it.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 450);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="status-selector" role="group" aria-label={t("today.updateStatusLabel")}>
      <div className="status-selector-title">{t("today.updateStatusLabel")}</div>
      <div className="status-selector-grid">
        {STATUS_SELECTOR_OPTIONS.map(({ action, tone, icon: Icon, labelKey }) => {
          const current = action === "reschedule" ? !!rescheduledLabel : action === status;
          const label =
            action === "reschedule" && rescheduledLabel
              ? t("today.rescheduledTo", { date: rescheduledLabel })
              : t(labelKey);
          return (
            <button
              key={action}
              type="button"
              disabled={disabled}
              className="status-selector-btn"
              data-tone={tone}
              data-status-option={action}
              data-current={current}
              aria-pressed={current}
              onClick={() => onSelect(action)}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="status-selector-label">{label}</span>
              {current && <span className="status-selector-mark" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ChipProps = {
  interactive: boolean;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  label: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

/**
 * The goal's current-status chip. When the status can be changed it is the
 * selector's trigger (a real button with aria-expanded); otherwise it stays the
 * plain read-only chip. Toggling only opens/closes the panel.
 */
export function StatusChipTrigger({ interactive, disabled, open, onToggle, label, style, children }: ChipProps) {
  if (!interactive) {
    return (
      <div className="status-chip" style={style}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="status-chip status-chip-trigger"
      style={style}
      disabled={disabled}
      aria-expanded={open}
      aria-label={label}
      {...{ [STATUS_TRIGGER_ATTR]: "" }}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}
