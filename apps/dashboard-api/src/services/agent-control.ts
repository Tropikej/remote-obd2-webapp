import type { CanConfigApplyRequest } from "@dashboard/shared";
import { ErrorCodes } from "@dashboard/shared";
import { AppError } from "../errors/app-error";
import { sendControlRequest } from "../ws/control";

type SendCanConfigResult = {
  effective: CanConfigApplyRequest;
  appliedAt: Date;
};

type CanConfigAckMessage = {
  type: "can_config_ack";
  request_id: string;
  dongle_id: string;
  effective: CanConfigApplyRequest;
  applied_at?: string;
};

export const sendCanConfig = async (
  agentId: string,
  dongleId: string,
  config: CanConfigApplyRequest
): Promise<SendCanConfigResult> => {
  const payload = {
    type: "can_config_apply",
    dongle_id: dongleId,
    config,
  };
  try {
    const response = await sendControlRequest<CanConfigAckMessage>(agentId, payload);
    if (!response || response.type !== "can_config_ack") {
      throw new Error("Invalid agent response.");
    }
    const appliedAt = response.applied_at ? new Date(response.applied_at) : new Date();
    return { effective: response.effective, appliedAt };
  } catch (error) {
    const message = (error as Error).message || "Agent control channel error.";
    const isOffline = message.toLowerCase().includes("offline");
    const isTimeout = message.toLowerCase().includes("timeout");
    const code = isOffline || isTimeout ? ErrorCodes.AGENT_OFFLINE : ErrorCodes.INTERNAL_ERROR;
    const status = isTimeout ? 504 : isOffline ? 503 : 502;
    throw new AppError(code, message, status);
  }
};

export { sendControlRequest };
