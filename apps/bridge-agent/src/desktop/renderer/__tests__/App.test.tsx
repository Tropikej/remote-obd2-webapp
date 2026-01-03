import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { vi } from "vitest";
import { App } from "../App";
import type { AgentStatusPayload } from "../../types";

const baseStatus: AgentStatusPayload = {
  apiBaseUrl: "http://localhost:3000",
  dashboardWebUrl: "http://localhost:5173",
  recentApiBaseUrls: ["http://localhost:3000"],
  agentId: null,
  wsStatus: "closed",
  lastHeartbeatAt: null,
  discoveryEnabled: true,
  discoveryActive: false,
  discoveredDevices: [],
  needsLogin: true,
  lastError: null,
};

const mockAgentApi = (status: AgentStatusPayload) => {
  window.agentApi = {
    login: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    updateSettings: vi.fn().mockResolvedValue({ ok: true, status }),
    getStatus: vi.fn().mockResolvedValue(status),
    toggleDiscovery: vi.fn().mockResolvedValue(undefined),
    onStatus: (handler) => {
      handler(status);
      return () => {};
    },
  };
};

const renderApp = async (status: AgentStatusPayload) => {
  mockAgentApi(status);
  await act(async () => {
    render(<App />);
    await Promise.resolve();
  });
};

test("renders login form when login is required", async () => {
  await renderApp(baseStatus);

  expect(await screen.findByText("Sign in")).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("submits credentials on login", async () => {
  const user = userEvent.setup();
  await renderApp(baseStatus);

  await act(async () => {
    await user.type(await screen.findByLabelText("Email"), "user@example.com");
  });
  await act(async () => {
    await user.type(await screen.findByLabelText("Password"), "Password123");
  });
  await act(async () => {
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
  });

  await waitFor(() => {
    expect(window.agentApi.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password123",
    });
  });
});

test("renders status view when logged in", async () => {
  const loggedInStatus: AgentStatusPayload = {
    ...baseStatus,
    needsLogin: false,
    agentId: "agent-123",
    wsStatus: "open",
  };
  await renderApp(loggedInStatus);

  expect(await screen.findByText("Agent status and controls.")).toBeInTheDocument();
  expect(screen.getByText("Agent ID: agent-123")).toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();
});

test("renders discovered devices in discovery card", async () => {
  const loggedInStatus: AgentStatusPayload = {
    ...baseStatus,
    needsLogin: false,
    agentId: "agent-123",
    wsStatus: "open",
    discoveredDevices: [
      {
        deviceId: "0011223344556677",
        lanIp: "192.168.1.50",
        udpPort: 16000,
        fwBuild: "H753-2025-12-28",
        ownershipState: "CLAIMED_ACTIVE",
        pairingState: 0,
        lastSeenAt: new Date().toISOString(),
      },
    ],
  };
  await renderApp(loggedInStatus);

  expect(await screen.findByText("0011223344556677")).toBeInTheDocument();
  expect(screen.getByText("Owned")).toBeInTheDocument();
  expect(screen.getByText("Pairing idle")).toBeInTheDocument();
});
