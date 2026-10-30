// Presentation-only rules for a standalone Today goal card's collapsed /
// normal state. Collapsing is purely visual: it never touches a goal's data,
// review status or priority, and it is independent of the control pill's
// open/closed state.
//
// RESOLVED cards (completed, canceled, blocked, ...) keep their original
// default: collapsed unless the user opened them (expandedDone). Every other
// card (pending review, not started, ...) keeps its original default --
// expanded -- but can now ALSO be collapsed by the user (collapsedPending).
export function isStandaloneCardCollapsed(args: {
  resolved: boolean;
  id: string;
  expandedDone: ReadonlySet<string>;
  collapsedPending: ReadonlySet<string>;
}): boolean {
  return args.resolved ? !args.expandedDone.has(args.id) : args.collapsedPending.has(args.id);
}

export function toggleId(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
