// src/utils/statusLabels.js
//
// One vocabulary for the assignment lifecycle, shared by Equipment and Vehicles.
//
// Both pages run the same three stages, but they used to name them differently:
// equipment said Assigned -> In Use -> Returned, vehicles said Scheduled ->
// In Use -> Completed. The last one is the real problem, not just an
// inconsistency: `booking_status` ALSO has a value called Completed, and it
// means something entirely different — the event was delivered. A manager
// reading "Completed" on a vehicle row was reading one word for "the van came
// back" and "the wedding happened".
//
// These are DISPLAY labels only. The schema is read-only, so
// `vehicle_assign.assignment_status` keeps its stored 'Scheduled' / 'Completed'
// values untouched; callers pass a plain boolean for the finished state, which
// is why no stored string ever reaches this file. That boundary is the point of
// the module — the mapping between what the database stores and what a manager
// reads lives in exactly one place, so the two can't drift apart again.

export const ASSIGNMENT_STAGES = {
  assigned: 'Assigned',
  in_use: 'In Use',
  returned: 'Returned',
};

// An assignment is only "In Use" once the event has actually started — before
// that it is merely reserved, and a chair promised to a wedding three days out
// is not in use by any reading of the word. With no event date we can't claim
// it's still upcoming, so it falls through to In Use rather than pretending.
//
// isFinished is a boolean the caller derives:
//   equipment -> booking_equipment.returned
//   vehicles  -> vehicle_assign.assignment_status === 'Completed'
export function getAssignmentStatus(isFinished, eventDatetimeStr) {
  if (isFinished) return { key: 'returned', label: ASSIGNMENT_STAGES.returned };
  if (eventDatetimeStr && new Date(eventDatetimeStr) > new Date()) {
    return { key: 'assigned', label: ASSIGNMENT_STAGES.assigned };
  }
  return { key: 'in_use', label: ASSIGNMENT_STAGES.in_use };
}

// Resource availability wording.
//
// "Free" and "Available" are deliberately different words for two different
// questions. A date-scoped view asks "is this free on the day I'm looking at?";
// a live view asks "is this available right now?" Using one word for both made
// the two views look like they disagreed whenever they were read side by side.
export const RESOURCE_STATE = {
  // Date-scoped: not promised to any booking on the selected date.
  free: 'Free',
  // Date-scoped: promised to a booking on that date, not yet out.
  committed: 'Committed',
  // Live: usable right now.
  available: 'Available',
  // Set aside for repair. Matches the value stored in equipment.eqm_status.
  underMaintenance: 'Under Maintenance',
  // Deliberately withdrawn from service.
  unavailable: 'Unavailable',
};
