// Lets any component (e.g. today/page.tsx after awarding points) tell the
// header to refetch the profile, without wiring up a shared store.
const POINTS_UPDATED_EVENT = "standup:points-updated";

export function notifyPointsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(POINTS_UPDATED_EVENT));
  }
}

export function onPointsUpdated(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(POINTS_UPDATED_EVENT, handler);
  return () => window.removeEventListener(POINTS_UPDATED_EVENT, handler);
}
