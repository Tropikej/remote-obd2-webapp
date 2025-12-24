import { Stack, Typography } from "@mui/material";
import {
  AppShell,
  AppTextField,
  InfoCard,
  PrimaryButton,
  StatusChip,
} from "@dashboard/ui";
import { useEffect, useMemo, useState } from "react";
import type { AgentStatusPayload } from "../types";

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const App = () => {
  const [status, setStatus] = useState<AgentStatusPayload | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    window.agentApi
      .getStatus()
      .then((current) => {
        setStatus(current);
        unsubscribe = window.agentApi.onStatus((next) => setStatus(next));
      })
      .catch((err) => setError((err as Error).message));

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.agentApi.login({ email, password });
      if (!result.ok) {
        setError(result.error || "Login failed.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const wsTone = useMemo(() => {
    if (!status) {
      return "neutral";
    }
    return status.wsStatus === "open" ? "success" : "warning";
  }, [status]);

  const wsLabel = status?.wsStatus === "open" ? "Connected" : "Disconnected";

  if (!status) {
    return (
      <AppShell title="OBD2 Bridge Agent" subtitle="Preparing agent status...">
        <StatusChip label="Loading" tone="warning" />
      </AppShell>
    );
  }

  if (status.needsLogin) {
    return (
      <AppShell title="OBD2 Bridge Agent" subtitle="Sign in to connect this device.">
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            if (!loading && email && password) {
              void handleLogin();
            }
          }}
        >
          <AppTextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <AppTextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <Typography color="error">{error}</Typography> : null}
          <PrimaryButton
            type="submit"
            disabled={loading || !email || !password}
          >
            {loading ? "Signing in..." : "Sign in"}
          </PrimaryButton>
        </Stack>
      </AppShell>
    );
  }

  return (
    <AppShell title="OBD2 Bridge Agent" subtitle="Agent status and controls.">
      <Stack spacing={2}>
        <InfoCard title="Connection">
          <Stack spacing={1}>
            <StatusChip label={wsLabel} tone={wsTone as "success" | "warning"} />
            <Typography color="text.secondary">
              API: {status.apiBaseUrl}
            </Typography>
          </Stack>
        </InfoCard>
        <InfoCard title="Agent">
          <Stack spacing={1}>
            <Typography>Agent ID: {status.agentId ?? "Unassigned"}</Typography>
            <Typography color="text.secondary">
              Last heartbeat: {formatTimestamp(status.lastHeartbeatAt)}
            </Typography>
          </Stack>
        </InfoCard>
        <InfoCard title="Discovery">
          <Stack spacing={1}>
            <StatusChip
              label={status.discoveryEnabled ? "Enabled" : "Disabled"}
              tone={status.discoveryEnabled ? "success" : "warning"}
            />
            <Typography color="text.secondary">
              Scanner: {status.discoveryActive ? "Active" : "Paused"}
            </Typography>
          </Stack>
        </InfoCard>
        {status.lastError ? (
          <Typography color="error">Last error: {status.lastError}</Typography>
        ) : null}
      </Stack>
    </AppShell>
  );
};
