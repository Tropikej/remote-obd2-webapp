export type CanRelayFrame = {
  ts: string;
  can_id: string;
  is_extended: boolean;
  dlc: number;
  data_hex: string;
  bus?: string;
  direction?: "rx" | "tx";
};

export type DataPlaneCanMessage = {
  type: "can_frame";
  group_id: string;
  dongle_id: string;
  frame: CanRelayFrame;
};

export type DataPlaneHelloMessage = {
  type: "hello";
  agent_id: string;
};

export type DataPlaneMessage = DataPlaneHelloMessage | DataPlaneCanMessage;
