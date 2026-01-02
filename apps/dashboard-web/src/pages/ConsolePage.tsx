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
  TextField,
  Typography,
} from "@mui/material";
import type { DongleSummary } from "@dashboard/shared";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api, type CommandStatus, type GroupResponse } from "../api/client";
import { useSse, type SseEvent } from "../hooks/useSse";

type TargetType = "dongle" | "group";

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "unknown");

const EventRow = ({ event }: { event: SseEvent }) => {
  const data = event.data as Record<string, any> | string | null;
  const renderPayload = () => {
    if (!data) return "no payload";
    if (typeof data === "string") return data;
    if (event.type === "can_frame") {
      return `id=${data.id ?? data.can_id ?? "?"} dir=${data.direction ?? "?"} dlc=${data.dlc ?? "?"} data=${data.data_hex ?? data.data ?? "?"} bus=${data.bus ?? "?"}`;
    }
    if (event.type === "presence") {
      return `online=${data.online} agent=${data.agent_id ?? "n/a"} seen_at=${data.seen_at ?? "?"}`;
    }
    if (event.type === "group_state") {
      return `mode=${data.mode} offline=${data.offline_side ?? "none"} backlog=${data.buffered_frames_a_to_b ?? 0}/${data.buffered_frames_b_to_a ?? 0}`;
    }
    if (event.type === "command_status") {
      return `command=${data.command_id ?? "unknown"} status=${data.status} exit=${data.exit_code ?? "?"}`;
    }
    if (event.type === "log") {
      return `${data.level ?? "info"}: ${data.message ?? JSON.stringify(data)}`;
    }
    if (event.type === "stream_reset") {
      return "stream history unavailable; showing live data";
    }
    return JSON.stringify(data);
  };
  return (
    <Stack spacing={0.5} sx={{ borderBottom: "1px solid rgba(255,255,255,0.06)", pb: 1, mb: 1 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
      >
        <StatusChip label={event.type} tone="neutral" />
        <Typography variant="caption" color="text.secondary">
          {new Date(event.receivedAt).toLocaleTimeString()}
        </Typography>
        {event.id ? (
          <Typography variant="caption" color="text.secondary">
            id {event.id}
          </Typography>
        ) : null}
      </Stack>
      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
        {renderPayload()}
      </Typography>
    </Stack>
  );
};

export const ConsolePage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTargetType: TargetType = searchParams.get("group") ? "group" : "dongle";
  const initialTargetId = searchParams.get("group") ?? searchParams.get("dongle") ?? "";
  const [targetType, setTargetType] = useState<TargetType>(initialTargetType);
  const [targetId, setTargetId] = useState<string>(initialTargetId);
  const [dongles, setDongles] = useState<DongleSummary[]>([]);
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState({ name: "remote", args: "status", timeout: 5000 });
  const [allowDangerous, setAllowDangerous] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [canFrame, setCanFrame] = useState({
    canId: "0x123",
    dataHex: "",
    isExtended: false,
    intervalMs: 500,
  });
  const [canMessage, setCanMessage] = useState<string | null>(null);
  const [canSending, setCanSending] = useState(false);
  const canTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canFrameRef = useRef(canFrame);
  const targetIdRef = useRef(targetId);
  const [filters, setFilters] = useState({
    showRx: true,
    showTx: true,
    showLogs: true,
    showPresence: true,
    search: "",
  });
  const isDevMode = import.meta.env.DEV;

  const streamUrl = useMemo(() => {
    if (!targetId) return null;
    return targetType === "dongle"
      ? api.streams.dongleConsoleUrl(targetId)
      : api.streams.groupConsoleUrl(targetId);
  }, [targetId, targetType]);

  const { events, connected, error: sseError, streamResets, clearEvents, lastEventId } = useSse(streamUrl);

  const canRate = useMemo(() => {
    const now = Date.now();
    const windowMs = 5000;
    const frames = events.filter((evt) => evt.type === "can_frame" && now - evt.receivedAt <= windowMs);
    return (frames.length / (windowMs / 1000)).toFixed(1);
  }, [events]);

  const filteredEvents = useMemo(() => {
    const text = filters.search.trim().toLowerCase();
    return events.filter((event) => {
      const data = event.data as any;
      if (event.type === "can_frame") {
        if (!filters.showRx && data?.direction === "rx") return false;
        if (!filters.showTx && data?.direction === "tx") return false;
      }
      if (event.type === "log" && !filters.showLogs) return false;
      if (event.type === "presence" && !filters.showPresence) return false;
      if (!text) return true;
      return JSON.stringify(event.data ?? "").toLowerCase().includes(text);
    });
  }, [events, filters]);

  const commandEvents = useMemo(
    () => events.filter((evt): evt is SseEvent<CommandStatus> => evt.type === "command_status"),
    [events]
  );

  const recentCanEvents = useMemo(() => {
    return events
      .filter((evt) => evt.type === "can_frame")
      .slice(-40)
      .reverse();
  }, [events]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dongleRes, groupRes] = await Promise.all([api.listDongles(), api.listGroups()]);
      setDongles(dongleRes.dongles);
      setGroups(groupRes.groups);
      if (!targetId) {
        const fallback = initialTargetType === "group" ? groupRes.groups[0]?.id ?? "" : dongleRes.dongles[0]?.id ?? "";
        setTargetId(fallback);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load console targets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    canFrameRef.current = canFrame;
  }, [canFrame]);

  useEffect(() => {
    targetIdRef.current = targetId;
    if (canTimerRef.current && targetType !== "dongle") {
      clearInterval(canTimerRef.current);
      canTimerRef.current = null;
      setCanSending(false);
    }
  }, [targetId, targetType]);

  useEffect(() => {
    return () => {
      if (canTimerRef.current) {
        clearInterval(canTimerRef.current);
        canTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!targetId) return;
    if (targetType === "group") {
      setSearchParams({ group: targetId });
    } else {
      setSearchParams({ dongle: targetId });
    }
  }, [targetType, targetId, setSearchParams]);

  const handleSendCommand = async (event: FormEvent) => {
    event.preventDefault();
    setCommandMessage(null);
    if (targetType !== "dongle" || !targetId) {
      setCommandMessage("Select a dongle to send commands.");
      return;
    }
    try {
      const args = command.args
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);
      const result = await api.sendCommand(targetId, {
        command: command.name,
        args,
        timeout_ms: command.timeout,
        command_target: "dongle",
        ...(allowDangerous && isDevMode ? { allow_dangerous: true } : {}),
      });
      setCommandMessage(`Command sent with id ${result.command_id} (${result.status}).`);
    } catch (err) {
      setCommandMessage(err instanceof ApiError ? err.message : "Failed to send command.");
    }
  };

  const sendCanOnce = async (frameOverride?: typeof canFrame) => {
    const activeTargetId = targetIdRef.current;
    if (targetType !== "dongle" || !activeTargetId) {
      setCanMessage("Select a dongle to send CAN frames.");
      return;
    }
    const payload = frameOverride ?? canFrameRef.current;
    setCanMessage(null);
    try {
      await api.sendCanFrame(activeTargetId, {
        can_id: payload.canId,
        is_extended: payload.isExtended,
        data_hex: payload.dataHex,
      });
      setCanMessage("CAN frame sent.");
    } catch (err) {
      setCanMessage(err instanceof ApiError ? err.message : "Failed to send CAN frame.");
    }
  };

  const togglePeriodic = () => {
    if (canTimerRef.current) {
      clearInterval(canTimerRef.current);
      canTimerRef.current = null;
      setCanSending(false);
      return;
    }
    if (targetType !== "dongle" || !targetIdRef.current) {
      setCanMessage("Select a dongle to send CAN frames.");
      return;
    }
    const interval = Math.max(50, Number(canFrameRef.current.intervalMs) || 0);
    if (!interval) {
      setCanMessage("Interval must be at least 50 ms.");
      return;
    }
    setCanMessage(null);
    setCanSending(true);
    void sendCanOnce();
    canTimerRef.current = setInterval(() => {
      void sendCanOnce();
    }, interval);
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Live console
        </Typography>
        <Typography color="text.secondary">
          Stream CAN frames, presence, logs, and command statuses. Streams reconnect automatically and resume when supported.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {sseError ? <Alert severity="warning">{sseError}</Alert> : null}
      {streamResets > 0 ? (
        <Alert severity="info">Stream reset received {streamResets} time(s). History was flushed.</Alert>
      ) : null}

      <InfoCard title="Target">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              select
              label="Target type"
              value={targetType}
              onChange={(e) => {
                const nextType = e.target.value as TargetType;
                setTargetType(nextType);
                const fallback = nextType === "dongle" ? dongles[0]?.id ?? "" : groups[0]?.id ?? "";
                setTargetId(fallback);
                if (nextType === "dongle") {
                  navigate("/console", { replace: true });
                } else {
                  navigate(`/console?group=${fallback}`, { replace: true });
                }
              }}
              fullWidth
            >
              <MenuItem value="dongle">Dongle</MenuItem>
              <MenuItem value="group">Group</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              label={targetType === "dongle" ? "Dongle" : "Group"}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              fullWidth
            >
              {(targetType === "dongle" ? dongles : groups).map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {targetType === "dongle" ? (item as DongleSummary).device_id : item.id}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <Stack spacing={1}>
              <StatusChip label={connected ? "Connected" : "Disconnected"} tone={connected ? "success" : "warning"} />
              <Typography variant="caption" color="text.secondary">
                Last Event ID: {lastEventId ?? "n/a"}
              </Typography>
              <Chip label={`CAN rate: ${canRate} evt/s`} size="small" />
              <Button variant="text" size="small" onClick={clearEvents}>
                Clear events
              </Button>
            </Stack>
          </Grid>
        </Grid>
      </InfoCard>

      <InfoCard title="Filters">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              label="Search"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              fullWidth
              placeholder="Match id, data, or text"
            />
          </Grid>
          <Grid item xs={12} md={9}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip
                label="RX"
                color={filters.showRx ? "primary" : "default"}
                onClick={() => setFilters((prev) => ({ ...prev, showRx: !prev.showRx }))}
                variant={filters.showRx ? "filled" : "outlined"}
              />
              <Chip
                label="TX"
                color={filters.showTx ? "primary" : "default"}
                onClick={() => setFilters((prev) => ({ ...prev, showTx: !prev.showTx }))}
                variant={filters.showTx ? "filled" : "outlined"}
              />
              <Chip
                label="Logs"
                color={filters.showLogs ? "primary" : "default"}
                onClick={() => setFilters((prev) => ({ ...prev, showLogs: !prev.showLogs }))}
                variant={filters.showLogs ? "filled" : "outlined"}
              />
              <Chip
                label="Presence"
                color={filters.showPresence ? "primary" : "default"}
                onClick={() => setFilters((prev) => ({ ...prev, showPresence: !prev.showPresence }))}
                variant={filters.showPresence ? "filled" : "outlined"}
              />
            </Stack>
          </Grid>
        </Grid>
      </InfoCard>

      <Grid container spacing={2}>
        <Grid item xs={12} md={targetType === "dongle" ? 8 : 12}>
          <InfoCard title="Events">
            {loading ? (
              <Typography>Loading...</Typography>
            ) : (
              <Box sx={{ maxHeight: 520, overflow: "auto" }}>
                {filteredEvents.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No events yet. Check filters or wait for traffic.
                  </Typography>
                ) : (
                  filteredEvents
                    .slice()
                    .reverse()
                    .map((evt) => <EventRow key={`${evt.receivedAt}-${evt.id ?? Math.random()}`} event={evt} />)
                )}
              </Box>
            )}
          </InfoCard>
        </Grid>

        {targetType === "dongle" ? (
          <Grid item xs={12} md={4}>
            <Stack spacing={2}>
              <InfoCard title="Command console">
                <Stack spacing={2} component="form" onSubmit={handleSendCommand}>
                  <Typography variant="body2" color="text.secondary">
                    Run a safe dongle CLI command. Status updates stream back via SSE.
                  </Typography>
                  {commandMessage ? <Alert severity="info">{commandMessage}</Alert> : null}
                  <TextField
                    label="Command"
                    value={command.name}
                    onChange={(e) => setCommand((prev) => ({ ...prev, name: e.target.value }))}
                    required
                    fullWidth
                  />
                  <TextField
                    label="Arguments"
                    value={command.args}
                    onChange={(e) => setCommand((prev) => ({ ...prev, args: e.target.value }))}
                    helperText="Space-separated"
                    fullWidth
                  />
                  <TextField
                    label="Timeout (ms)"
                    type="number"
                    value={command.timeout}
                    onChange={(e) =>
                      setCommand((prev) => ({ ...prev, timeout: Number(e.target.value) || 0 }))
                    }
                    inputProps={{ min: 1000 }}
                    fullWidth
                  />
                  {isDevMode ? (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={allowDangerous}
                          onChange={(e) => setAllowDangerous(e.target.checked)}
                        />
                      }
                      label="Allow dangerous commands (dev only)"
                    />
                  ) : null}
                  <PrimaryButton type="submit" disabled={!targetId}>
                    Send command
                  </PrimaryButton>
                </Stack>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Command log
                </Typography>
                <Box sx={{ maxHeight: 240, overflow: "auto" }}>
                  {commandEvents.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No command activity yet.
                    </Typography>
                  ) : (
                    commandEvents
                      .slice(-10)
                      .reverse()
                      .map((evt) => {
                        const data = evt.data as CommandStatus;
                        return (
                          <Box
                            key={`${evt.id}-${evt.receivedAt}`}
                            sx={{ borderBottom: "1px solid rgba(255,255,255,0.06)", pb: 1, mb: 1 }}
                          >
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={1}
                              flexWrap="wrap"
                              sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
                            >
                              <Typography variant="body2">
                                {data.command_id} – {data.status}
                              </Typography>
                              {data.command_target ? (
                                <Chip label={`target:${data.command_target}`} size="small" />
                              ) : null}
                              {data.command_source ? (
                                <Chip label={`source:${data.command_source}`} size="small" />
                              ) : null}
                              {data.truncated ? (
                                <Chip label="truncated" size="small" color="warning" />
                              ) : null}
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              Started: {formatDate(data.started_at)} | Done:{" "}
                              {formatDate(data.completed_at)}
                            </Typography>
                            {data.stdout ? (
                              <Typography
                                variant="caption"
                                display="block"
                                sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}
                              >
                                stdout: {data.stdout}
                              </Typography>
                            ) : null}
                            {data.stderr ? (
                              <Typography
                                variant="caption"
                                display="block"
                                color="error"
                                sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}
                              >
                                stderr: {data.stderr}
                              </Typography>
                            ) : null}
                          </Box>
                        );
                      })
                  )}
                </Box>
              </InfoCard>
              <InfoCard title="CAN console">
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    Send a CAN frame to the selected dongle and watch live traffic.
                  </Typography>
                  {canMessage ? <Alert severity="info">{canMessage}</Alert> : null}
                  <Stack spacing={2} component="form" onSubmit={(e) => { e.preventDefault(); void sendCanOnce(); }}>
                    <TextField
                      label="CAN ID"
                      value={canFrame.canId}
                      onChange={(e) =>
                        setCanFrame((prev) => ({ ...prev, canId: e.target.value }))
                      }
                      required
                      fullWidth
                    />
                    <TextField
                      label="Data (hex)"
                      value={canFrame.dataHex}
                      onChange={(e) =>
                        setCanFrame((prev) => ({ ...prev, dataHex: e.target.value }))
                      }
                      helperText="Up to 8 bytes (16 hex chars)"
                      fullWidth
                    />
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={2}
                      sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
                    >
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={canFrame.isExtended}
                            onChange={(e) =>
                              setCanFrame((prev) => ({
                                ...prev,
                                isExtended: e.target.checked,
                              }))
                            }
                          />
                        }
                        label="Extended ID"
                      />
                      <TextField
                        label="Interval (ms)"
                        type="number"
                        value={canFrame.intervalMs}
                        onChange={(e) =>
                          setCanFrame((prev) => ({
                            ...prev,
                            intervalMs: Number(e.target.value) || 0,
                          }))
                        }
                        inputProps={{ min: 50 }}
                        fullWidth
                        sx={{ maxWidth: { xs: "100%", sm: 160 } }}
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <PrimaryButton
                        type="submit"
                        disabled={!targetId}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                      >
                        Send once
                      </PrimaryButton>
                      <Button
                        variant="outlined"
                        onClick={togglePeriodic}
                        disabled={!targetId}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                      >
                        {canSending ? "Stop periodic" : "Start periodic"}
                      </Button>
                    </Stack>
                  </Stack>
                  <Divider />
                  <Typography variant="subtitle2">Live CAN frames</Typography>
                  <Box sx={{ maxHeight: 220, overflow: "auto" }}>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "60px 40px 30px 1fr", sm: "80px 60px 40px 1fr" },
                        columnGap: 1,
                        pb: 1,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        ID
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Dir
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        DLC
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Data
                      </Typography>
                    </Box>
                    {recentCanEvents.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No CAN frames yet.
                      </Typography>
                    ) : (
                      recentCanEvents.map((evt) => {
                        const data = evt.data as Record<string, any>;
                        return (
                          <Box
                            key={`${evt.id}-${evt.receivedAt}`}
                            sx={{
                              display: "grid",
                              gridTemplateColumns: { xs: "60px 40px 30px 1fr", sm: "80px 60px 40px 1fr" },
                              columnGap: 1,
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              py: 0.5,
                            }}
                          >
                            <Typography variant="caption">
                              {data.id ?? data.can_id ?? "?"}
                            </Typography>
                            <Typography variant="caption">
                              {(data.direction ?? "?").toString().toUpperCase()}
                            </Typography>
                            <Typography variant="caption">{data.dlc ?? "?"}</Typography>
                            <Typography
                              variant="caption"
                              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                            >
                              {data.data_hex ?? data.data ?? "?"}
                            </Typography>
                          </Box>
                        );
                      })
                    )}
                  </Box>
                </Stack>
              </InfoCard>
            </Stack>
          </Grid>
        ) : null}
      </Grid>
    </Stack>
  );
};
