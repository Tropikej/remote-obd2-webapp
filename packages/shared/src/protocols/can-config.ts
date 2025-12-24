export type CanConfigApplyRequest = {
  bitrate: number;
  sample_point_permille: number;
  mode: "normal" | "listen_only" | "loopback" | "ext_loop";
  use_raw: boolean;
  prescaler: number;
  sjw: number;
  tseg1: number;
  tseg2: number;
  auto_retx: boolean;
  tx_pause: boolean;
  protocol_exc: boolean;
};

export type CanConfigApplyResponse = {
  dongle_id: string;
  applied: boolean;
  effective: CanConfigApplyRequest;
  applied_at: string;
};
