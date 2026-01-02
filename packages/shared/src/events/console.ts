export type PresenceEvent = {
  type: "presence";
  dongle_id: string;
  online: boolean;
  agent_id?: string | null;
  seen_at: string;
};

export type CanFrameEvent = {
  type: "can_frame";
  group_id?: string;
  dongle_id?: string;
  direction?: "rx" | "tx" | "a_to_b" | "b_to_a";
  bus?: string;
  id?: string;
  can_id?: string;
  is_extended?: boolean;
  dlc?: number;
  data_hex?: string;
  ts: string;
};

export type LogEvent = {
  type: "log";
  level: "info" | "warn" | "error";
  message: string;
  code?: string;
  ts: string;
};

export type CommandStatusEvent = {
  type: "command_status";
  command_id: string;
  status: "queued" | "running" | "ok" | "error" | "timeout" | "cancelled";
  dongle_id?: string;
  group_id?: string;
  command_target?: "agent" | "dongle";
  command_source?: "web" | "agent" | "system";
  started_at?: string | null;
  completed_at?: string | null;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
};

export type GroupStateEvent = {
  type: "group_state";
  group_id: string;
  mode: string;
  offline_side?: "A" | "B" | null;
  buffered_frames_a_to_b?: number;
  buffered_frames_b_to_a?: number;
  ts: string;
};

export type StreamResetEvent = {
  type: "stream_reset";
  reason: "history_unavailable" | "buffer_cleared";
  ts: string;
};

export type ConsoleEvent =
  | PresenceEvent
  | CanFrameEvent
  | LogEvent
  | CommandStatusEvent
  | GroupStateEvent
  | StreamResetEvent;
