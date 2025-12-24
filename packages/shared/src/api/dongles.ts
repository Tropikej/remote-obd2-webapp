export type DongleSummary = {
  id: string;
  device_id: string;
  ownership_state: string;
  last_seen_at: string | null;
  lan_ip: string | null;
  fw_build: string | null;
  udp_port: number | null;
};

export type DongleDetail = DongleSummary & {
  owner_user_id: string | null;
  can_config: CanConfigPayload | null;
};

export type CanConfigPayload = {
  bitrate: number;
  sample_point_permille: number;
  mode: string;
  use_raw: boolean;
  prescaler: number;
  sjw: number;
  tseg1: number;
  tseg2: number;
  auto_retx: boolean;
  tx_pause: boolean;
  protocol_exc: boolean;
};
