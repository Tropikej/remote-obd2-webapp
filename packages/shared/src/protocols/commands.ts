export type CommandTarget = "agent" | "dongle";
export type CommandSource = "web" | "agent" | "system";

export type CommandRequestMessage = {
  type: "command_request";
  command_id: string;
  dongle_id: string;
  command: string;
  args: string[];
  timeout_ms: number;
  command_target?: CommandTarget;
  command_source?: CommandSource;
  allow_dangerous?: boolean;
};

export type CommandResponseMessage = {
  type: "command_response" | "command_status";
  command_id: string;
  status: "queued" | "running" | "ok" | "error" | "timeout";
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  started_at?: string | null;
  completed_at?: string | null;
  dongle_id?: string;
  group_id?: string;
  command_target?: CommandTarget;
  command_source?: CommandSource;
  truncated?: boolean;
};

export type CommandChunkMessage = {
  type: "command_chunk";
  command_id: string;
  seq: number;
  is_last: boolean;
  stream: "stdout" | "stderr";
  data: string; // base64
  dongle_id?: string;
  command_target?: CommandTarget;
  command_source?: CommandSource;
  truncated?: boolean;
};

export type CommandAgentMessage =
  | CommandRequestMessage
  | CommandResponseMessage
  | CommandChunkMessage;
