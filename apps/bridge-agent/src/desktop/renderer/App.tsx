import { Button, Divider, Stack, Typography } from "@mui/material";
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

const formatOwnershipLabel = (value?: string | null) => {
  if (!value) {
    return "Ownership unknown";
  }
  if (value.includes("UNCLAIMED")) {
    return "Unclaimed";
  }
  if (value.includes("SECURITY")) {
    return "Security hold";
  }
  if (value.includes("CLAIMED")) {
    return "Owned";
  }
  return value;
};

const ownershipTone = (value?: string | null): "success" | "warning" | "neutral" => {
  if (!value) {
    return "neutral";
  }
  if (value.includes("ACTIVE")) {
    return "success";
  }
  if (value.includes("SECURITY")) {
    return "warning";
  }
  return "neutral";
};

const formatPairingLabel = (value?: number | null) => {
  if (value === 1) {
    return "Pairing active";
  }
  if (value === 0) {
    return "Pairing idle";
  }
  return "Pairing unknown";
};

const pairingTone = (value?: number | null): "success" | "warning" | "neutral" => {
  if (value === 1) {
    return "warning";
  }
  if (value === 0) {
    return "neutral";
  }
  return "neutral";
};

export const App = () => {
  const [status, setStatus] = useState<AgentStatusPayload | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsApiBaseUrl, setSettingsApiBaseUrl] = useState("");
  const [settingsDashboardUrl, setSettingsDashboardUrl] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!status || settingsDirty) {
      return;
    }
    setSettingsApiBaseUrl(status.apiBaseUrl);
    setSettingsDashboardUrl(status.dashboardWebUrl);
  }, [status, settingsDirty]);

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

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const result = await window.agentApi.updateSettings({
        apiBaseUrl: settingsApiBaseUrl,
        dashboardWebUrl: settingsDashboardUrl,
      });
      if (!result.ok) {
        setSettingsError(result.error || "Unable to update settings.");
        return;
      }
      if (result.status) {
        setStatus(result.status);
      }
      setSettingsDirty(false);
    } catch (err) {
      setSettingsError((err as Error).message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const wsTone = useMemo(() => {
    if (!status) {
      return "neutral";
    }
    return status.wsStatus === "open" ? "success" : "warning";
  }, [status]);

  const wsLabel = status?.wsStatus === "open" ? "Connected" : "Disconnected";
  const discoveredDevices = status?.discoveredDevices ?? [];
  const recentApiBaseUrls = status?.recentApiBaseUrls ?? [];
  const saveDisabled = settingsSaving || !settingsApiBaseUrl.trim();

  const settingsCard = status ? (
    <InfoCard title="Server settings">
      <Stack spacing={1.5}>
        <AppTextField
          label="API base URL"
          placeholder="https://baltringuelabs.cam"
          value={settingsApiBaseUrl}
          onChange={(event) => {
            setSettingsApiBaseUrl(event.target.value);
            setSettingsDirty(true);
          }}
        />
        <AppTextField
          label="Dashboard URL"
          placeholder="https://baltringuelabs.cam"
          value={settingsDashboardUrl}
          onChange={(event) => {
            setSettingsDashboardUrl(event.target.value);
            setSettingsDirty(true);
          }}
        />
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setSettingsApiBaseUrl("http://localhost:3000");
              setSettingsDirty(true);
            }}
          >
            Use local API
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setSettingsDashboardUrl("http://localhost:5173");
              setSettingsDirty(true);
            }}
          >
            Use local dashboard
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setSettingsDashboardUrl(settingsApiBaseUrl.trim());
              setSettingsDirty(true);
            }}
          >
            Dashboard = API
          </Button>
        </Stack>
        {recentApiBaseUrls.length > 0 ? (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Recent API endpoints
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {recentApiBaseUrls.map((entry) => (
                <Button
                  key={entry}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setSettingsApiBaseUrl(entry);
                    setSettingsDirty(true);
                  }}
                >
                  {entry}
                </Button>
              ))}
            </Stack>
          </Stack>
        ) : null}
        {settingsError ? <Typography color="error">{settingsError}</Typography> : null}
        <PrimaryButton disabled={saveDisabled} onClick={() => void handleSaveSettings()}>
          {settingsSaving ? "Saving..." : "Save settings"}
        </PrimaryButton>
      </Stack>
    </InfoCard>
  ) : null;

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
        <Stack spacing={2}>
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
          {settingsCard}
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
            <Typography color="text.secondary">
              Dashboard: {status.dashboardWebUrl}
            </Typography>
          </Stack>
        </InfoCard>
        {settingsCard}
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
            <Typography color="text.secondary">
              Devices: {discoveredDevices.length}
            </Typography>
            {discoveredDevices.length === 0 ? (
              <Typography color="text.secondary">
                No dongles discovered on this network yet.
              </Typography>
            ) : (
              <Stack spacing={1} divider={<Divider flexItem />}>
                {discoveredDevices.map((device) => (
                  <Stack key={device.deviceId} spacing={0.5}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2">{device.deviceId}</Typography>
                      <StatusChip
                        label={formatOwnershipLabel(device.ownershipState)}
                        tone={ownershipTone(device.ownershipState)}
                      />
                      <StatusChip
                        label={formatPairingLabel(device.pairingState)}
                        tone={pairingTone(device.pairingState)}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      LAN: {device.lanIp ?? "unknown"} | UDP: {device.udpPort ?? "?"} | FW:{" "}
                      {device.fwBuild ?? "unknown"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Last seen: {formatTimestamp(device.lastSeenAt)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </InfoCard>
        {status.lastError ? (
          <Typography color="error">Last error: {status.lastError}</Typography>
        ) : null}
      </Stack>
    </AppShell>
  );
};
