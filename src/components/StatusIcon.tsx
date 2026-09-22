import { CheckCircle2, Settings2, Ban, CalendarClock, Diamond, XCircle, Circle, type LucideIcon } from "lucide-react";
import type { GoalStatus } from "@/lib/supabase/db";

const STATUS_ICONS: Record<GoalStatus, LucideIcon> = {
  completed: CheckCircle2,
  in_progress: Settings2,
  blocked: Ban,
  postponed: CalendarClock,
  attempted: Diamond,
  canceled: XCircle,
  not_started: Circle,
};

/** Same icon mapping goalStatus.ts's statusLabel/statusChipColors use, as a component so callers don't have to juggle a bare component reference. Renders with currentColor, so it inherits the chip/badge's own color. */
export default function StatusIcon({ status, size = 14, className }: { status: GoalStatus; size?: number; className?: string }) {
  const Icon = STATUS_ICONS[status] ?? Circle;
  return <Icon size={size} className={className} />;
}
