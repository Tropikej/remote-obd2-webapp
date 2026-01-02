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
  dongle_id: string;
  group_id?: string;
  target_dongle_id?: string;
  direction?: "a_to_b" | "b_to_a";
  frame: CanRelayFrame;
};

export type DataPlaneHelloMessage = {
  type: "hello";
  agent_id: string;
};

export type DataPlaneMessage = DataPlaneHelloMessage | DataPlaneCanMessage;
