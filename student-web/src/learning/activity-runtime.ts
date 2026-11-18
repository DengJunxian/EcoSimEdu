import type { Activity, ActivityState, LearningPackage, Phase, SessionState } from "./education-types";

export function phaseActivities(pack: LearningPackage, phase: Phase) {
  const activities = pack.activities.filter(activity => activity.phase === phase);
  const successors = new Set(activities.map(activity => activity.next_activity_id));
  return { activities, first: activities.find(activity => activity.kind === "assessment" && !successors.has(activity.id)) };
}

export function visitActivity(state: SessionState, activity: Activity | undefined, phase: Phase, previous?: {
  id: string; state: ActivityState;
}) {
  const accessible = new Set(state.accessible_activity_ids);
  const activity_states = { ...state.activity_states };
  if (activity) {
    accessible.add(activity.id);
    activity_states[activity.id] ??= "in_progress";
  }
  if (previous) activity_states[previous.id] = previous.state;
  return {
    ...state, current_activity_id: activity?.id, accessible_activity_ids: [...accessible], activity_states,
    phase_cursor: { ...state.phase_cursor, [phase]: activity?.id ?? "done" },
    return_stack: activity?.return_activity_id ? [activity.return_activity_id] : [],
  };
}
