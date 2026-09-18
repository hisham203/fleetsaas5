/** P2-01: Exported lifecycle stage sequence for use in tests and helpers. */
export const STAGE_SEQUENCE = [
  "STARTED",
  "ARRIVED_LOADING",
  "LOADING_COMPLETE",
  "ARRIVED_SITE",
  "UNLOADING_COMPLETE",
  "CLOSED",
] as const;

export const VALID_LIFECYCLE_EVENT_TYPES = [...STAGE_SEQUENCE, "NOTE", "EXCEPTION", "GPS_PING"] as const;
