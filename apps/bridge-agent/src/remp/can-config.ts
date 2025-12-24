import type { CanConfigApplyRequest } from "@dashboard/shared/protocols/can-config";

type ApplyCanConfigResult = {
  effective: CanConfigApplyRequest;
};

export const applyCanConfigToDongle = async (
  _dongleId: string,
  config: CanConfigApplyRequest
): Promise<ApplyCanConfigResult> => {
  // Placeholder until the REMP can-config transport is implemented.
  return { effective: config };
};
