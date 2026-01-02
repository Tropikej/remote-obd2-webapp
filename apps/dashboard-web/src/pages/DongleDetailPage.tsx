import { InfoCard, PrimaryButton, StatusChip } from "@dashboard/ui";
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { CanConfigPayload, DongleDetail } from "@dashboard/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";

const DEFAULT_CONFIG: CanConfigPayload = {
  bitrate: 500000,
  sample_point_permille: 875,
  mode: "normal",
  use_raw: false,
  prescaler: 16,
  sjw: 1,
  tseg1: 13,
  tseg2: 2,
  auto_retx: true,
  tx_pause: false,
  protocol_exc: false,
};

const CONFIG_MODES = ["normal", "listen_only", "loopback", "ext_loop"];

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "never");

export const DongleDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dongle, setDongle] = useState<DongleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingSessionId, setPairingSessionId] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingCountdown, setPairingCountdown] = useState<string | null>(null);
  const [pairingPin, setPairingPin] = useState("");
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const [pairingWarning, setPairingWarning] = useState(false);
  const [config, setConfig] = useState<CanConfigPayload>(DEFAULT_CONFIG);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [unpairMessage, setUnpairMessage] = useState<string | null>(null);

  const ownershipTone = useMemo(() => {
    if (!dongle) return "neutral";
    if (dongle.ownership_state.includes("ACTIVE")) return "success";
    if (dongle.ownership_state.includes("SECURITY")) return "warning";
    return "neutral";
  }, [dongle]);

  const loadDongle = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDongle(id);
      setDongle(data);
      const nextConfig = data.can_config ?? DEFAULT_CONFIG;
      setConfig(nextConfig);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load dongle.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDongle();
  }, [id]);

  useEffect(() => {
    if (!pairingExpiresAt) {
      setPairingCountdown(null);
      return;
    }
    const update = () => {
      const remaining = new Date(pairingExpiresAt).getTime() - Date.now();
      if (remaining <= 0) {
        setPairingCountdown("expired");
        setPairingSessionId("");
        return;
      }
      setPairingCountdown(`${Math.ceil(remaining / 1000)}s remaining`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [pairingExpiresAt]);

  const handleStartPairing = async () => {
    if (!id) return;
    setPairingMessage(null);
    setPairingWarning(false);
    try {
      const result = await api.startPairingMode(id);
      if (result.paired) {
        setPairingMessage("Dongle already paired.");
        return;
      }
      if (result.pairing_session_id) {
        setPairingSessionId(result.pairing_session_id);
        setPairingExpiresAt(result.expires_at ?? null);
        setPairingMessage("Pairing mode started. Enter the PIN to continue.");
      } else if (result.hold_until) {
        setPairingWarning(true);
        setPairingMessage(`Security hold until ${result.hold_until}. Wait before retrying.`);
      } else {
        setPairingMessage("Pairing mode request acknowledged.");
      }
    } catch (err) {
      setPairingWarning(true);
      setPairingMessage(err instanceof ApiError ? err.message : "Unable to start pairing session.");
    }
  };

  const handleSubmitPairing = async (event: FormEvent) => {
    event.preventDefault();
    if (!id) return;
    if (!pairingSessionId) {
      setPairingWarning(true);
      setPairingMessage("Start pairing mode to get a session ID first.");
      return;
    }
    try {
      const result = await api.submitPairing(id, {
        pairing_session_id: pairingSessionId,
        pin: pairingPin,
      });
      if (result.status === "ok") {
        setPairingWarning(false);
        setPairingMessage("Pairing successful.");
        await loadDongle();
      } else if (result.status === "hold") {
        setPairingWarning(true);
        setPairingMessage(`Security hold in effect until ${result.hold_until ?? "later"}.`);
      } else {
        setPairingWarning(true);
        setPairingMessage("PIN invalid. Check attempts remaining.");
      }
    } catch (err) {
      setPairingWarning(true);
      setPairingMessage(err instanceof ApiError ? err.message : "Pairing failed.");
    }
  };

  const handleConfigChange = (key: keyof CanConfigPayload, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyConfig = async (event: FormEvent) => {
    event.preventDefault();
    if (!id) return;
    setConfigError(null);
    setConfigMessage(null);
    const numericFields: (keyof CanConfigPayload)[] = [
      "bitrate",
      "sample_point_permille",
      "prescaler",
      "sjw",
      "tseg1",
      "tseg2",
    ];
    for (const key of numericFields) {
      const value = config[key];
      if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
        setConfigError(`Field ${key} must be a positive number.`);
        return;
      }
    }
    if (!CONFIG_MODES.includes(config.mode)) {
      setConfigError("Select a valid mode.");
      return;
    }
    try {
      const result = await api.applyCanConfig(id, config);
      setConfig(result.effective);
      setConfigMessage(
        `CAN configuration applied${result.applied_at ? ` at ${formatDate(result.applied_at)}` : ""}.`
      );
    } catch (err) {
      setConfigError(err instanceof ApiError ? err.message : "Failed to apply CAN config.");
    }
  };

  const handleUnpair = async () => {
    if (!id) return;
    setUnpairMessage(null);
    try {
      await api.unpairDongle(id);
      setUnpairMessage("Dongle unpaired.");
      await loadDongle();
    } catch (err) {
      setUnpairMessage(err instanceof ApiError ? err.message : "Failed to unpair dongle.");
    }
  };

  if (loading) {
    return <Typography>Loading dongle...</Typography>;
  }

  if (!dongle || error) {
    return (
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Button variant="outlined" onClick={() => navigate("/dongles")}>
          Back to list
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Button variant="text" onClick={() => navigate("/dongles")}>
          {"<"} Back to dongles
        </Button>
        <Typography variant="h4" gutterBottom>
          Dongle {dongle.device_id}
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          flexWrap="wrap"
          sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
        >
          <StatusChip label={dongle.ownership_state} tone={ownershipTone as any} />
          <Typography color="text.secondary">
            Last seen: {formatDate(dongle.last_seen_at)} | LAN: {dongle.lan_ip ?? "?"}
          </Typography>
          <Button variant="text" size="small" onClick={() => navigate(`/console?dongle=${dongle.id}`)}>
            Open console
          </Button>
        </Stack>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <InfoCard title="Pairing">
            <Stack spacing={2} component="form" onSubmit={handleSubmitPairing}>
              <Typography variant="body2" color="text.secondary">
                Start pairing mode to receive a session ID and expiry, then submit the PIN shown on the dongle.
              </Typography>
              {pairingMessage ? (
                <Alert severity={pairingWarning ? "warning" : "info"}>{pairingMessage}</Alert>
              ) : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="contained"
                  onClick={handleStartPairing}
                  data-testid="pairing-start"
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                >
                  Start pairing mode
                </Button>
                <TextField
                  label="Pairing session id"
                  value={pairingSessionId}
                  onChange={(e) => setPairingSessionId(e.target.value)}
                  fullWidth
                  inputProps={{ "data-testid": "pairing-session-id" }}
                />
              </Stack>
              {pairingExpiresAt ? (
                <Typography variant="body2" color="text.secondary">
                  Expires at {pairingExpiresAt} {pairingCountdown ? `(${pairingCountdown})` : ""}
                </Typography>
              ) : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  label="PIN"
                  value={pairingPin}
                  onChange={(e) => setPairingPin(e.target.value)}
                  inputProps={{ maxLength: 12, "data-testid": "pairing-pin" }}
                  fullWidth
                  required
                />
                <PrimaryButton type="submit" sx={{ width: { xs: "100%", sm: "auto" } }}>
                  Submit PIN
                </PrimaryButton>
              </Stack>
            </Stack>
          </InfoCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <InfoCard title="Ownership">
            <Stack spacing={1}>
              <Typography variant="body2">
                Owner user id: {dongle.owner_user_id ?? "none"}
              </Typography>
              <Typography variant="body2">Firmware: {dongle.fw_build ?? "unknown"}</Typography>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack spacing={1}>
              {unpairMessage ? <Alert severity="info">{unpairMessage}</Alert> : null}
              <Button variant="outlined" color="warning" onClick={handleUnpair}>
                Unpair dongle
              </Button>
            </Stack>
          </InfoCard>
        </Grid>
      </Grid>

      <InfoCard title="CAN configuration">
        <form onSubmit={handleApplyConfig}>
          <Stack spacing={2}>
            {configError ? <Alert severity="error">{configError}</Alert> : null}
            {configMessage ? <Alert severity="success">{configMessage}</Alert> : null}
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Bitrate"
                  type="number"
                  value={config.bitrate}
                  onChange={(e) => handleConfigChange("bitrate", Number(e.target.value))}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Sample point (permille)"
                  type="number"
                  value={config.sample_point_permille}
                  onChange={(e) =>
                    handleConfigChange("sample_point_permille", Number(e.target.value))
                  }
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  select
                  label="Mode"
                  value={config.mode}
                  onChange={(e) => handleConfigChange("mode", e.target.value)}
                  fullWidth
                  required
                >
                  {CONFIG_MODES.map((mode) => (
                    <MenuItem key={mode} value={mode}>
                      {mode}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  label="Prescaler"
                  type="number"
                  value={config.prescaler}
                  onChange={(e) => handleConfigChange("prescaler", Number(e.target.value))}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  label="SJW"
                  type="number"
                  value={config.sjw}
                  onChange={(e) => handleConfigChange("sjw", Number(e.target.value))}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  label="TSEG1"
                  type="number"
                  value={config.tseg1}
                  onChange={(e) => handleConfigChange("tseg1", Number(e.target.value))}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  label="TSEG2"
                  type="number"
                  value={config.tseg2}
                  onChange={(e) => handleConfigChange("tseg2", Number(e.target.value))}
                  fullWidth
                  required
                />
              </Grid>
            </Grid>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              flexWrap="wrap"
              sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={config.use_raw}
                    onChange={(e) => handleConfigChange("use_raw", e.target.checked)}
                  />
                }
                label="Use raw"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.auto_retx}
                    onChange={(e) => handleConfigChange("auto_retx", e.target.checked)}
                  />
                }
                label="Auto retransmit"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.tx_pause}
                    onChange={(e) => handleConfigChange("tx_pause", e.target.checked)}
                  />
                }
                label="TX pause"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.protocol_exc}
                    onChange={(e) => handleConfigChange("protocol_exc", e.target.checked)}
                  />
                }
                label="Protocol exception"
              />
            </Stack>
            <PrimaryButton type="submit">Apply configuration</PrimaryButton>
          </Stack>
        </form>
      </InfoCard>
    </Stack>
  );
};
