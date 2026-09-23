// Lets any component that changes a connection/goal-assignment's pending
// or seen state (Social, Today, Tomorrow, Dashboard's PendingNotifications)
// tell the header to refetch its notification-bell count, without wiring
// up a shared store. Same pattern as pointsBus.ts.
const NOTIFICATIONS_UPDATED_EVENT = "standup:notifications-updated";

export function notifyNotificationsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
  }
}

export function onNotificationsUpdated(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handler);
}
