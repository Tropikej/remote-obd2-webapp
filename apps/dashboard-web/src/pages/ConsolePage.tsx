import { InfoCard, PrimaryButton, StatusChip } from "@dashboard/ui";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { DongleSummary } from "@dashboard/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
      <Stack direction="row" spacing={1} alignItems="center">
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
  const [command, setCommand] = useState({ name: "ifconfig", args: "", timeout: 5000 });
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    showRx: true,
    showTx: true,
    showLogs: true,
    showPresence: true,
    search: "",
  });

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
      });
      setCommandMessage(`Command sent with id ${result.command_id} (${result.status}).`);
    } catch (err) {
      setCommandMessage(err instanceof ApiError ? err.message : "Failed to send command.");
    }
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
            <InfoCard title="Command console">
              <Stack spacing={2} component="form" onSubmit={handleSendCommand}>
                <Typography variant="body2" color="text.secondary">
                  Send a command to the selected dongle. Status updates stream back via SSE.
                </Typography>
                {commandMessage ? <Alert severity="info">{commandMessage}</Alert> : null}
                <TextField
                  label="Command"
                  value={command.name}
                  onChange={(e) => setCommand((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
                <TextField
                  label="Arguments"
                  value={command.args}
                  onChange={(e) => setCommand((prev) => ({ ...prev, args: e.target.value }))}
                  helperText="Space-separated"
                />
                <TextField
                  label="Timeout (ms)"
                  type="number"
                  value={command.timeout}
                  onChange={(e) => setCommand((prev) => ({ ...prev, timeout: Number(e.target.value) || 0 }))}
                  inputProps={{ min: 1000 }}
                />
                <PrimaryButton type="submit" disabled={!targetId}>
                  Send command
                </PrimaryButton>
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" gutterBottom>
                Latest command statuses
              </Typography>
              <Stack spacing={1}>
                {events
                  .filter((e): e is SseEvent<CommandStatus> => e.type === "command_status")
                  .slice(-5)
                  .reverse()
                  .map((evt) => {
                    const data = evt.data as CommandStatus;
                    return (
                      <Box
                        key={`${evt.id}-${evt.receivedAt}`}
                        sx={{ borderBottom: "1px solid rgba(255,255,255,0.06)", pb: 1 }}
                      >
                        <Typography variant="body2">
                          {data.command_id} — {data.status}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Started: {formatDate(data.started_at)} | Done: {formatDate(data.completed_at)}
                        </Typography>
                        {data.stdout ? (
                          <Typography variant="caption" display="block">
                            stdout: {data.stdout}
                          </Typography>
                        ) : null}
                        {data.stderr ? (
                          <Typography variant="caption" display="block">
                            stderr: {data.stderr}
                          </Typography>
                        ) : null}
                      </Box>
                    );
                  })}
              </Stack>
            </InfoCard>
          </Grid>
        ) : null}
      </Grid>
    </Stack>
  );
};
