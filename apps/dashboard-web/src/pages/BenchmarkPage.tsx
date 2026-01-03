import { InfoCard, PrimaryButton, StatusChip } from "@dashboard/ui";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { DongleSummary } from "@dashboard/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type BenchmarkMode } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSse, type SseEvent } from "../hooks/useSse";

type DelayLevel = "ok" | "warn" | "error" | "none";

type BenchmarkFrame = {
  key: string;
  receivedAt: number;
  deltaMs: number | null;
  canId: string;
  dlc: number;
  payload: string;
  delayLevel: DelayLevel;
  direction?: string;
};

type BenchmarkAlert = {
  id: string;
  severity: "warning" | "error";
  message: string;
  ts: number;
};

const MAX_FRAMES = 200;
const MAX_ALERTS = 20;
const DELAY_WARN_MS = 25;
const DELAY_ERROR_MS = 50;

const normalizeCanId = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/^0x/, "");

const parseHexPayload = (value: string) => {
  const trimmed = value.trim().toLowerCase().replace(/^0x/, "");
  const normalized = trimmed.replace(/\s+/g, "");
  if (!normalized) return [];
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    return null;
  }
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i += 2) {
    bytes.push(Number.parseInt(normalized.slice(i, i + 2), 16));
  }
  return bytes;
};

const incrementPayload = (payload: number[]) => {
  const next = [...payload];
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] < 0xff) {
      next[i] += 1;
      return next;
    }
    next[i] = 0;
  }
  return next;
};

const bytesToHex = (payload: number[]) =>
  payload.map((byte) => byte.toString(16).padStart(2, "0")).join("");

const classifyDelay = (deltaMs: number | null): DelayLevel => {
  if (deltaMs === null) return "none";
  if (deltaMs > DELAY_ERROR_MS) return "error";
  if (deltaMs > DELAY_WARN_MS) return "warn";
  return "ok";
};

const formatDelta = (deltaMs: number | null) =>
  deltaMs === null ? "n/a" : `${deltaMs.toFixed(1)} ms`;

export const BenchmarkPage = () => {
  const { user } = useAuth();
  const [dongles, setDongles] = useState<DongleSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<BenchmarkAlert[]>([]);
  const [frames, setFrames] = useState<BenchmarkFrame[]>([]);
  const [sending, setSending] = useState(false);
  const [expectedDelayMs, setExpectedDelayMs] = useState(25);
  const [orderCheckEnabled, setOrderCheckEnabled] = useState(true);
  const [sendConfig, setSendConfig] = useState({
    mode: "ordered" as BenchmarkMode,
    canId: "0x123",
    dlc: 8,
    delayMs: 50,
    isExtended: false,
  });

  const configRef = useRef(sendConfig);
  const targetIdRef = useRef(targetId);
  const expectedDelayRef = useRef(expectedDelayMs);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProcessedRef = useRef<{ id: string | null; receivedAt: number } | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const orderingStateRef = useRef(new Map<string, number[]>());

  useEffect(() => {
    configRef.current = sendConfig;
  }, [sendConfig]);

  useEffect(() => {
    targetIdRef.current = targetId;
  }, [targetId]);

  useEffect(() => {
    expectedDelayRef.current = expectedDelayMs;
  }, [expectedDelayMs]);

  const streamUrl = useMemo(() => {
    if (!targetId || user?.role !== "super_admin") return null;
    return api.streams.benchmarkDongleUrl(targetId);
  }, [targetId, user?.role]);

  const { events, connected, error: sseError, streamResets, clearEvents } = useSse(streamUrl, {
    eventTypes: ["can_frame", "stream_reset"],
    bufferSize: 1000,
  });

  const loadDongles = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { dongles } = await api.listDongles();
      setDongles(dongles);
      if (!targetId) {
        setTargetId(dongles[0]?.id ?? "");
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load dongles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || user.role !== "super_admin") {
      return;
    }
    void loadDongles();
  }, [user]);

  const resetState = () => {
    clearEvents();
    setFrames([]);
    setAlerts([]);
    lastProcessedRef.current = null;
    lastFrameTimeRef.current = null;
    orderingStateRef.current.clear();
  };

  useEffect(() => {
    resetState();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  useEffect(() => {
    orderingStateRef.current.clear();
  }, [orderCheckEnabled]);

  useEffect(() => {
    if (!sending) {
      return;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const delay = Math.max(1, Number(configRef.current.delayMs) || 0);
    timerRef.current = setInterval(() => {
      void sendOnce();
    }, delay);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, sendConfig.delayMs]);

  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    const lastProcessed = lastProcessedRef.current;
    let nextEvents = events;
    if (lastProcessed) {
      if (lastProcessed.id) {
        const idx = events.findIndex((evt) => evt.id === lastProcessed.id);
        if (idx >= 0) {
          nextEvents = events.slice(idx + 1);
        } else {
          nextEvents = events.filter((evt) => evt.receivedAt > lastProcessed.receivedAt);
        }
      } else {
        nextEvents = events.filter((evt) => evt.receivedAt > lastProcessed.receivedAt);
      }
    }
    if (nextEvents.length === 0) {
      return;
    }
    const latestEvent = nextEvents[nextEvents.length - 1];
    lastProcessedRef.current = { id: latestEvent.id ?? null, receivedAt: latestEvent.receivedAt };

    const newFrames: BenchmarkFrame[] = [];
    const newAlerts: BenchmarkAlert[] = [];

    nextEvents.forEach((event: SseEvent) => {
      if (event.type !== "can_frame") return;
      const data = (event.data as Record<string, any>) ?? {};
      const canId = (data.id ?? data.can_id ?? "?").toString();
      const payload = (data.data_hex ?? data.data ?? "").toString();
      const dlc =
        typeof data.dlc === "number" ? data.dlc : Math.floor(payload.length / 2) || 0;
      const direction = typeof data.direction === "string" ? data.direction : undefined;
      const deltaMs =
        lastFrameTimeRef.current === null
          ? null
          : event.receivedAt - lastFrameTimeRef.current;
      lastFrameTimeRef.current = event.receivedAt;
      const delayLevel = classifyDelay(deltaMs);
      const expectedDelay = expectedDelayRef.current;

      if (deltaMs !== null && expectedDelay > 0 && deltaMs > expectedDelay) {
        const severity = deltaMs > DELAY_ERROR_MS ? "error" : "warning";
        newAlerts.push({
          id: `${event.receivedAt}-delay`,
          severity,
          ts: event.receivedAt,
          message: `Delay ${deltaMs.toFixed(1)} ms exceeds expected ${expectedDelay} ms.`,
        });
      }

      const canKey = normalizeCanId(canId);
      const bytes = parseHexPayload(payload);
      const isRxLike = !direction || direction !== "tx";
      if (orderCheckEnabled && isRxLike && canKey && bytes) {
        const key = `${canKey}:${bytes.length}`;
        const previous = orderingStateRef.current.get(key);
        if (previous) {
          const expected = incrementPayload(previous);
          const expectedHex = bytesToHex(expected);
          const receivedHex = bytesToHex(bytes);
          if (expectedHex !== receivedHex) {
            newAlerts.push({
              id: `${event.receivedAt}-order-${key}`,
              severity: "error",
              ts: event.receivedAt,
              message: `Order mismatch for ${canId}. Expected ${expectedHex} got ${receivedHex}.`,
            });
          }
        }
        orderingStateRef.current.set(key, bytes);
      }

      newFrames.push({
        key: `${event.id ?? "evt"}-${event.receivedAt}`,
        receivedAt: event.receivedAt,
        deltaMs,
        canId,
        dlc,
        payload,
        delayLevel,
        direction,
      });
    });

    if (newFrames.length > 0) {
      setFrames((prev) => {
        const next = [...prev, ...newFrames];
        if (next.length > MAX_FRAMES) {
          next.splice(0, next.length - MAX_FRAMES);
        }
        return next;
      });
    }
    if (newAlerts.length > 0) {
      setAlerts((prev) => {
        const next = [...newAlerts, ...prev];
        if (next.length > MAX_ALERTS) {
          next.splice(MAX_ALERTS);
        }
        return next;
      });
    }
  }, [events, orderCheckEnabled]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const sendOnce = async () => {
    setSendError(null);
    const activeTarget = targetIdRef.current;
    if (!activeTarget) {
      setSendError("Select a dongle first.");
      return;
    }
    const current = configRef.current;
    if (current.delayMs < 0) {
      setSendError("Delay must be zero or a positive number.");
      return;
    }
    try {
      await api.benchmarkSend(activeTarget, {
        mode: current.mode,
        delay_ms: current.delayMs,
        can_id: current.mode === "ordered" ? current.canId : undefined,
        dlc: current.dlc,
        is_extended: current.isExtended,
      });
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Failed to send benchmark frame.");
    }
  };

  const toggleSending = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setSending(false);
      return;
    }
    if (!targetId) {
      setSendError("Select a dongle first.");
      return;
    }
    const rawDelay = Number(configRef.current.delayMs) || 0;
    if (rawDelay <= 0) {
      setSendError("Delay must be a positive number.");
      return;
    }
    const delay = Math.max(1, rawDelay);
    setSending(true);
    void sendOnce();
  };

  if (!user || user.role !== "super_admin") {
    return <Alert severity="error">You must be a super admin to view benchmark tools.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Benchmark
        </Typography>
        <Typography color="text.secondary">
          Monitor CAN timing and ordering, and send ordered or fuzz frames on demand.
        </Typography>
      </Box>

      {loadError ? <Alert severity="error">{loadError}</Alert> : null}
      {sseError ? <Alert severity="warning">{sseError}</Alert> : null}
      {sendError ? <Alert severity="error">{sendError}</Alert> : null}
      {streamResets > 0 ? (
        <Alert severity="info">Stream reset received {streamResets} time(s). History was flushed.</Alert>
      ) : null}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <InfoCard title="Target">
              <Stack spacing={2} data-testid="benchmark-target-card">
                <TextField
                  select
                  label="Dongle"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  fullWidth
                  data-testid="benchmark-target-id"
                >
                  {dongles.map((dongle) => (
                    <MenuItem key={dongle.id} value={dongle.id}>
                      {dongle.device_id}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack spacing={1}>
                  <StatusChip label={connected ? "Connected" : "Disconnected"} tone={connected ? "success" : "warning"} />
                  <Typography variant="caption" color="text.secondary">
                    Frames tracked: {frames.length}
                  </Typography>
                </Stack>
                <Button variant="text" size="small" onClick={resetState}>
                  Clear frames and alerts
                </Button>
              </Stack>
            </InfoCard>

            <InfoCard title="Sender">
              <Stack spacing={2} data-testid="benchmark-sender-card">
                <TextField
                  select
                  label="Mode"
                  value={sendConfig.mode}
                  onChange={(e) =>
                    setSendConfig((prev) => ({ ...prev, mode: e.target.value as BenchmarkMode }))
                  }
                  fullWidth
                  data-testid="benchmark-mode"
                >
                  <MenuItem value="ordered">Ordered</MenuItem>
                  <MenuItem value="fuzz">Fuzz</MenuItem>
                </TextField>
                <TextField
                  label="CAN ID"
                  value={sendConfig.canId}
                  onChange={(e) => setSendConfig((prev) => ({ ...prev, canId: e.target.value }))}
                  fullWidth
                  disabled={sendConfig.mode !== "ordered"}
                  helperText={
                    sendConfig.mode === "ordered" ? "Required for ordered mode (hex, e.g. 0x123)." : "Managed by fuzzing."
                  }
                  data-testid="benchmark-can-id"
                />
                <TextField
                  label="DLC"
                  type="number"
                  value={sendConfig.dlc}
                  onChange={(e) =>
                    setSendConfig((prev) => ({ ...prev, dlc: Number(e.target.value) || 0 }))
                  }
                  inputProps={{ min: 0, max: 8, "data-testid": "benchmark-dlc" }}
                  fullWidth
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={sendConfig.isExtended}
                      onChange={(e) =>
                        setSendConfig((prev) => ({ ...prev, isExtended: e.target.checked }))
                      }
                      inputProps={{ "data-testid": "benchmark-extended" }}
                    />
                  }
                  label="Extended ID"
                />
                <TextField
                  label="Send delay (ms)"
                  type="number"
                  value={sendConfig.delayMs}
                  onChange={(e) =>
                    setSendConfig((prev) => ({ ...prev, delayMs: Number(e.target.value) || 0 }))
                  }
                  inputProps={{ min: 1, "data-testid": "benchmark-delay" }}
                  fullWidth
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <PrimaryButton onClick={sendOnce} disabled={!targetId} data-testid="benchmark-send-once">
                    Send once
                  </PrimaryButton>
                  <Button
                    variant="outlined"
                    onClick={toggleSending}
                    disabled={!targetId}
                    data-testid="benchmark-send-toggle"
                  >
                    {sending ? "Stop sending" : "Start sending"}
                  </Button>
                </Stack>
              </Stack>
            </InfoCard>

            <InfoCard title="Delay thresholds">
              <Stack spacing={2} data-testid="benchmark-delay-card">
                <TextField
                  label="Expected delay (ms)"
                  type="number"
                  value={expectedDelayMs}
                  onChange={(e) => setExpectedDelayMs(Number(e.target.value) || 0)}
                  inputProps={{ min: 1, "data-testid": "benchmark-expected-delay" }}
                  helperText={`Target max delay. Status: <=${DELAY_WARN_MS}ms OK, >${DELAY_WARN_MS}ms warn, >${DELAY_ERROR_MS}ms error.`}
                  fullWidth
                />
                <Divider />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label={`OK <= ${DELAY_WARN_MS}ms`} color="success" size="small" />
                  <Chip label={`Warn > ${DELAY_WARN_MS}ms`} color="warning" size="small" />
                  <Chip label={`Error > ${DELAY_ERROR_MS}ms`} color="error" size="small" />
                </Stack>
                <Divider />
                <FormControlLabel
                  control={
                    <Switch
                      checked={orderCheckEnabled}
                      onChange={(e) => setOrderCheckEnabled(e.target.checked)}
                      inputProps={{ "data-testid": "benchmark-order-check" }}
                    />
                  }
                  label="Enable ordering detection"
                />
              </Stack>
            </InfoCard>
          </Stack>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={2}>
            <InfoCard title="Alerts">
              {alerts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No ordering or delay violations yet.
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ maxHeight: 200, overflow: "auto" }} data-testid="benchmark-alerts">
                  {alerts.map((alert) => (
                    <Alert key={alert.id} severity={alert.severity}>
                      {new Date(alert.ts).toLocaleTimeString()} - {alert.message}
                    </Alert>
                  ))}
                </Stack>
              )}
            </InfoCard>

            <InfoCard title="Received CAN frames">
              {loading ? (
                <Typography>Loading dongles...</Typography>
              ) : (
                <Box sx={{ maxHeight: 520, overflow: "auto" }} data-testid="benchmark-frames">
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "80px 70px 60px 1fr",
                        sm: "100px 90px 70px 1fr",
                        md: "120px 110px 80px 1fr 60px",
                      },
                      columnGap: 1,
                      pb: 1,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      Time
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Delta
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      CAN ID
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Payload
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
                      DLC
                    </Typography>
                  </Box>
                  {frames.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No CAN frames yet.
                    </Typography>
                  ) : (
                    frames
                      .slice()
                      .reverse()
                      .map((frame) => (
                        <Box
                          key={frame.key}
                          sx={{
                            display: "grid",
                            gridTemplateColumns: {
                              xs: "80px 70px 60px 1fr",
                              sm: "100px 90px 70px 1fr",
                              md: "120px 110px 80px 1fr 60px",
                            },
                            columnGap: 1,
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            py: 0.5,
                          }}
                        >
                          <Typography variant="caption">
                            {new Date(frame.receivedAt).toLocaleTimeString()}
                          </Typography>
                          <Box>
                            {frame.delayLevel === "none" ? (
                              <Chip label="n/a" size="small" />
                            ) : (
                              <Chip
                                label={formatDelta(frame.deltaMs)}
                                size="small"
                                color={
                                  frame.delayLevel === "error"
                                    ? "error"
                                    : frame.delayLevel === "warn"
                                      ? "warning"
                                      : "success"
                                }
                              />
                            )}
                          </Box>
                          <Typography variant="caption">{frame.canId}</Typography>
                          <Typography
                            variant="caption"
                            sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                          >
                            {frame.payload}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{ display: { xs: "none", md: "block" } }}
                          >
                            {frame.dlc}
                          </Typography>
                        </Box>
                      ))
                  )}
                </Box>
              )}
            </InfoCard>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
};
