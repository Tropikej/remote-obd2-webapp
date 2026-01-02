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
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { DongleDetail, DongleSummary } from "@dashboard/shared";
import { FormEvent, type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api, type CommandStatus, type GroupResponse } from "../api/client";
import { useSse, type SseEvent } from "../hooks/useSse";

type TargetType = "dongle" | "group";

type TabPanelProps = {
  value: number;
  index: number;
  children: React.ReactNode;
  testId?: string;
};

const TabPanel = ({ value, index, children, testId }: TabPanelProps) => {
  if (value !== index) {
    return null;
  }
  return (
    <Box role="tabpanel" aria-labelledby={`console-tab-${index}`} sx={{ pt: 2 }} data-testid={testId}>
      {children}
    </Box>
  );
};

const normalizeCanId = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/^0x/, "");

const matchesCanId = (value: string | null | undefined, filter: string) => {
  if (!filter.trim()) return true;
  const normalizedFilter = normalizeCanId(filter);
  const candidate = normalizeCanId(value);
  if (!candidate) return false;
  return candidate.includes(normalizedFilter);
};

const estimateFrameBits = (data: Record<string, any>) => {
  const dlcRaw =
    typeof data?.dlc === "number"
      ? data.dlc
      : typeof data?.data_hex === "string"
        ? Math.floor(data.data_hex.length / 2)
        : 0;
  const dlc = Math.min(Math.max(dlcRaw, 0), 8);
  const isExtended = data?.is_extended === true;
  const baseBits = isExtended ? 67 : 47;
  return baseBits + dlc * 8;
};

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
  const [selectedDongle, setSelectedDongle] = useState<DongleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [command, setCommand] = useState({ name: "remote", args: "status", timeout: 5000 });
  const [allowDangerous, setAllowDangerous] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [canFrame, setCanFrame] = useState({
    canId: "0x123",
    dataHex: "",
    isExtended: false,
    intervalMs: 500,
  });
  const [eventsOpen, setEventsOpen] = useState(true);
  const [canMessage, setCanMessage] = useState<string | null>(null);
  const [canSending, setCanSending] = useState(false);
  const canTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canFrameRef = useRef(canFrame);
  const targetIdRef = useRef(targetId);
  const [filters, setFilters] = useState({
    showCan: true,
    showCommands: true,
    showLogs: true,
    showPresence: true,
    showGroupState: true,
    showStreamReset: true,
    showRx: true,
    showTx: true,
    search: "",
    canId: "",
  });
  const isDevMode = import.meta.env.DEV;

  const streamUrl = useMemo(() => {
    if (!targetId) return null;
    return targetType === "dongle"
      ? api.streams.dongleConsoleUrl(targetId)
      : api.streams.groupConsoleUrl(targetId);
  }, [targetId, targetType]);

  const { events, connected, error: sseError, streamResets, clearEvents, lastEventId } = useSse(streamUrl);

  const canStats = useMemo(() => {
    const now = Date.now();
    const windowMs = 5000;
    const frames = events.filter((evt) => evt.type === "can_frame" && now - evt.receivedAt <= windowMs);
    const rxCount = frames.filter((evt) => (evt.data as any)?.direction === "rx").length;
    const txCount = frames.filter((evt) => (evt.data as any)?.direction === "tx").length;
    const total = frames.length;
    const rate = total / (windowMs / 1000);
    return { rxCount, txCount, total, rate, windowMs };
  }, [events]);

  const bitrate = selectedDongle?.can_config?.bitrate ?? null;
  const bitrateKnown = typeof bitrate === "number" && bitrate > 0;
  const busLoad = useMemo(() => {
    if (!bitrateKnown) return null;
    const windowSec = canStats.windowMs / 1000;
    const totalBits = events
      .filter((evt) => evt.type === "can_frame" && Date.now() - evt.receivedAt <= canStats.windowMs)
      .reduce((sum, evt) => sum + estimateFrameBits(evt.data as Record<string, any>), 0);
    const load = totalBits / (bitrate * windowSec);
    return Math.min(Math.max(load, 0), 1);
  }, [events, bitrateKnown, bitrate, canStats.windowMs]);

  const filtersActive = useMemo(() => {
    if (filters.search.trim() || filters.canId.trim()) return true;
    if (!filters.showCan || !filters.showCommands || !filters.showLogs || !filters.showPresence) return true;
    if (!filters.showGroupState || !filters.showStreamReset) return true;
    if (!filters.showRx || !filters.showTx) return true;
    return false;
  }, [filters]);

  const filteredEvents = useMemo(() => {
    const text = filters.search.trim().toLowerCase();
    return events.filter((event) => {
      const data = event.data as any;
      if (event.type === "can_frame") {
        if (!filters.showCan) return false;
        if (!filters.showRx && data?.direction === "rx") return false;
        if (!filters.showTx && data?.direction === "tx") return false;
        const idValue = data?.id ?? data?.can_id ?? "";
        if (!matchesCanId(idValue, filters.canId)) return false;
      }
      if (event.type === "command_status" && !filters.showCommands) return false;
      if (event.type === "log" && !filters.showLogs) return false;
      if (event.type === "presence" && !filters.showPresence) return false;
      if (event.type === "group_state" && !filters.showGroupState) return false;
      if (event.type === "stream_reset" && !filters.showStreamReset) return false;
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
      .filter((evt) => {
        const data = evt.data as any;
        const idValue = data?.id ?? data?.can_id ?? "";
        return matchesCanId(idValue, filters.canId);
      })
      .slice(-40)
      .reverse();
  }, [events, filters.canId]);

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
    if (!targetId || targetType !== "dongle") {
      setSelectedDongle(null);
      return;
    }
    let cancelled = false;
    api
      .getDongle(targetId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedDongle(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedDongle(null);
        }
      });
    return () => {
      cancelled = true;
    };
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

  const handleTabChange = (_event: SyntheticEvent, value: number) => {
    setActiveTab(value);
  };

  const busLoadLabel = bitrateKnown
    ? `Bus load (est): ${(busLoad ?? 0) * 100 < 0.1 ? "<0.1" : ((busLoad ?? 0) * 100).toFixed(1)}%`
    : "Bus load: missing parameters (bitrate unknown)";

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

      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <Stack spacing={2}>
            <Box data-testid="console-target-card">
              <InfoCard title="Target">
                <Stack spacing={2}>
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
                    data-testid="console-target-type"
                  >
                    <MenuItem value="dongle">Dongle</MenuItem>
                    <MenuItem value="group">Group</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label={targetType === "dongle" ? "Dongle" : "Group"}
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    fullWidth
                    data-testid="console-target-id"
                  >
                    {(targetType === "dongle" ? dongles : groups).map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {targetType === "dongle" ? (item as DongleSummary).device_id : item.id}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Stack spacing={1}>
                    <StatusChip label={connected ? "Connected" : "Disconnected"} tone={connected ? "success" : "warning"} />
                    <Typography variant="caption" color="text.secondary">
                      Last Event ID: {lastEventId ?? "n/a"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      CAN rate: {canStats.rate.toFixed(1)} evt/s
                    </Typography>
                    <Button variant="text" size="small" onClick={clearEvents}>
                      Clear events
                    </Button>
                  </Stack>
                </Stack>
              </InfoCard>
            </Box>

            <Box data-testid="console-filters-card">
              <InfoCard title="Filters">
                <Stack spacing={2}>
                  <TextField
                    label="Search"
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    fullWidth
                    placeholder="Match id, data, or text"
                    data-testid="console-filter-search"
                  />
                  <Divider />
                  <Typography variant="subtitle2">Event types</Typography>
                  <Stack spacing={1}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showCan}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showCan: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-can" }}
                        />
                      }
                      label="CAN"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showCommands}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showCommands: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-commands" }}
                        />
                      }
                      label="Commands"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showLogs}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showLogs: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-logs" }}
                        />
                      }
                      label="Logs"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showPresence}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showPresence: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-presence" }}
                        />
                      }
                      label="Presence"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showGroupState}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showGroupState: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-group" }}
                        />
                      }
                      label="Group state"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showStreamReset}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showStreamReset: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-reset" }}
                        />
                      }
                      label="Stream reset"
                    />
                  </Stack>
                  <Divider />
                  <Typography variant="subtitle2">CAN direction</Typography>
                  <Stack spacing={1}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showRx}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showRx: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-rx" }}
                        />
                      }
                      label="RX"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={filters.showTx}
                          onChange={(e) => setFilters((prev) => ({ ...prev, showTx: e.target.checked }))}
                          inputProps={{ "data-testid": "console-filter-tx" }}
                        />
                      }
                      label="TX"
                    />
                  </Stack>
                </Stack>
              </InfoCard>
            </Box>
          </Stack>
        </Grid>

        <Grid item xs={12} md={eventsOpen ? 6 : 9}>
          <Box data-testid="console-tabs-card">
            <InfoCard title="Console">
              {!eventsOpen ? (
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => setEventsOpen(true)}
                    data-testid="console-events-show"
                  >
                    Show events
                  </Button>
                </Stack>
              ) : null}
              <Tabs value={activeTab} onChange={handleTabChange} aria-label="Console tabs">
                <Tab label="CAN console" id="console-tab-0" data-testid="console-tab-can" />
                <Tab label="Command console" id="console-tab-1" data-testid="console-tab-command" />
              </Tabs>

              <TabPanel value={activeTab} index={0} testId="console-panel-can">
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    Send a CAN frame to the selected dongle and monitor live traffic.
                  </Typography>
                  {canMessage ? <Alert severity="info">{canMessage}</Alert> : null}
                  <Stack
                    spacing={2}
                    component="form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendCanOnce();
                    }}
                    data-testid="console-can-form"
                  >
                    <TextField
                      label="CAN ID"
                      value={canFrame.canId}
                      onChange={(e) =>
                        setCanFrame((prev) => ({ ...prev, canId: e.target.value }))
                      }
                      required
                      fullWidth
                      data-testid="console-can-id"
                    />
                    <TextField
                      label="Data (hex)"
                      value={canFrame.dataHex}
                      onChange={(e) =>
                        setCanFrame((prev) => ({ ...prev, dataHex: e.target.value }))
                      }
                      helperText="Up to 8 bytes (16 hex chars)"
                      fullWidth
                      data-testid="console-can-data"
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
                            inputProps={{ "data-testid": "console-can-extended" }}
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
                        inputProps={{ min: 50, "data-testid": "console-can-interval" }}
                        fullWidth
                        sx={{ maxWidth: { xs: "100%", sm: 160 } }}
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <PrimaryButton
                        type="submit"
                        disabled={!targetId}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                        data-testid="console-can-send"
                      >
                        Send once
                      </PrimaryButton>
                      <Button
                        variant="outlined"
                        onClick={togglePeriodic}
                        disabled={!targetId}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                        data-testid="console-can-periodic"
                      >
                        {canSending ? "Stop periodic" : "Start periodic"}
                      </Button>
                    </Stack>
                  </Stack>

                  <Divider />

                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2">CAN stats (last 5s)</Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap">
                      <Chip label={`Frames: ${canStats.total}`} size="small" />
                      <Chip label={`RX: ${canStats.rxCount}`} size="small" />
                      <Chip label={`TX: ${canStats.txCount}`} size="small" />
                      <Chip
                        label={
                          bitrateKnown
                            ? `Bitrate: ${bitrate?.toLocaleString()} bps`
                            : "Bitrate: unknown"
                        }
                        size="small"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {busLoadLabel}
                    </Typography>
                  </Stack>

                  <Divider />

                  <TextField
                    label="Filter CAN ID"
                    value={filters.canId}
                    onChange={(e) => setFilters((prev) => ({ ...prev, canId: e.target.value }))}
                    fullWidth
                    placeholder="e.g. 0x123"
                    data-testid="console-can-filter"
                  />

                  <Typography variant="subtitle2">Live CAN frames</Typography>
                  <Box sx={{ maxHeight: 240, overflow: "auto" }} data-testid="console-can-frames">
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
              </TabPanel>
              <TabPanel value={activeTab} index={1} testId="console-panel-command">
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    Run a safe dongle CLI command. Status updates stream back via SSE.
                  </Typography>
                  {commandMessage ? <Alert severity="info">{commandMessage}</Alert> : null}
                  <Stack spacing={2} component="form" onSubmit={handleSendCommand} data-testid="console-command-form">
                    <TextField
                      label="Command"
                      value={command.name}
                      onChange={(e) => setCommand((prev) => ({ ...prev, name: e.target.value }))}
                      required
                      fullWidth
                      data-testid="console-command-name"
                    />
                    <TextField
                      label="Arguments"
                      value={command.args}
                      onChange={(e) => setCommand((prev) => ({ ...prev, args: e.target.value }))}
                      helperText="Space-separated"
                      fullWidth
                      data-testid="console-command-args"
                    />
                    <TextField
                      label="Timeout (ms)"
                      type="number"
                      value={command.timeout}
                      onChange={(e) =>
                        setCommand((prev) => ({ ...prev, timeout: Number(e.target.value) || 0 }))
                      }
                      inputProps={{ min: 1000, "data-testid": "console-command-timeout" }}
                      fullWidth
                    />
                    {isDevMode ? (
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={allowDangerous}
                            onChange={(e) => setAllowDangerous(e.target.checked)}
                            inputProps={{ "data-testid": "console-command-dangerous" }}
                          />
                        }
                        label="Allow dangerous commands (dev only)"
                      />
                    ) : null}
                    <PrimaryButton type="submit" disabled={!targetId} data-testid="console-command-send">
                      Send command
                    </PrimaryButton>
                  </Stack>

                  <Divider />

                  <Typography variant="subtitle2">Command log</Typography>
                  <Box
                    sx={{
                      backgroundColor: "#fff",
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 1,
                      color: "text.primary",
                      px: 2,
                      py: 1.5,
                      maxHeight: 260,
                      overflow: "auto",
                      fontFamily: "monospace",
                    }}
                    data-testid="console-command-log"
                  >
                    {commandEvents.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No command activity yet.
                      </Typography>
                    ) : (
                      commandEvents
                        .slice(-12)
                        .reverse()
                        .map((evt) => {
                          const data = evt.data as CommandStatus;
                          return (
                            <Box
                              key={`${evt.id}-${evt.receivedAt}`}
                              sx={{ borderBottom: "1px solid rgba(255,255,255,0.08)", pb: 1, mb: 1 }}
                            >
                              <Stack
                                direction={{ xs: "column", sm: "row" }}
                                spacing={1}
                                flexWrap="wrap"
                                sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
                              >
                                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                                  [{new Date(evt.receivedAt).toLocaleTimeString()}] {data.command_id} - {data.status}
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
                </Stack>
              </TabPanel>
            </InfoCard>
          </Box>
        </Grid>

        {eventsOpen ? (
          <Grid item xs={12} md={3}>
            <Box data-testid="console-events-card">
              <InfoCard title="Events">
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => setEventsOpen(false)}
                    data-testid="console-events-hide"
                  >
                    Hide events
                  </Button>
                </Stack>
                {filtersActive ? (
                  <Typography variant="caption" color="text.secondary" data-testid="console-filters-active">
                    Filters active
                  </Typography>
                ) : null}
                {loading ? (
                  <Typography>Loading...</Typography>
                ) : (
                  <Box sx={{ maxHeight: 560, overflow: "auto", mt: 1 }} data-testid="console-events-list">
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
            </Box>
          </Grid>
        ) : null}
      </Grid>
    </Stack>
  );
};
