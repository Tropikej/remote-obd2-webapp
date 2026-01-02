import { InfoCard, PrimaryButton, StatusChip } from "@dashboard/ui";
import {
  Alert,
  Box,
  Button,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { DongleSummary } from "@dashboard/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api, type GroupResponse } from "../api/client";

const modeTone = (mode: string) => {
  if (mode.toLowerCase().includes("degrad")) return "warning";
  if (mode.toLowerCase().includes("active")) return "success";
  return "neutral";
};

export const GroupsPage = () => {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [dongles, setDongles] = useState<DongleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [createPayload, setCreatePayload] = useState({ a: "", b: "" });

  const ownedDongles = useMemo(() => dongles.filter((d) => d.ownership_state.includes("ACTIVE")), [dongles]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupsRes, donglesRes] = await Promise.all([api.listGroups(), api.listDongles()]);
      setGroups(groupsRes.groups);
      setDongles(donglesRes.dongles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load groups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setActionMessage(null);
    if (!createPayload.a || !createPayload.b || createPayload.a === createPayload.b) {
      setError("Select two distinct dongles to create a group.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const group = await api.createGroup({
        dongle_a_id: createPayload.a,
        dongle_b_id: createPayload.b,
      });
      setGroups((prev) => [group, ...prev]);
      setCreatePayload({ a: "", b: "" });
      setActionMessage("Group created. Activate it to start relaying.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create group.");
    } finally {
      setCreating(false);
    }
  };

  const handleActivate = async (groupId: string, mode: "activate" | "deactivate") => {
    setActionMessage(null);
    try {
      const next =
        mode === "activate" ? await api.activateGroup(groupId) : await api.deactivateGroup(groupId);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? next : g)));
      setActionMessage(mode === "activate" ? "Group activated." : "Group deactivated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update group state.");
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Groups
        </Typography>
        <Typography color="text.secondary">
          Create and activate groups to relay CAN frames between two owned dongles. Degraded state shows buffering if one side is offline.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}

      <InfoCard title="Create group">
        <Stack component="form" spacing={2} onSubmit={handleCreate}>
          <Typography variant="body2" color="text.secondary">
            Select two owned dongles. Only one active group per dongle is supported.
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                select
                label="Dongle A"
                value={createPayload.a}
                onChange={(e) => setCreatePayload((prev) => ({ ...prev, a: e.target.value }))}
                fullWidth
                required
                data-testid="group-dongle-a"
              >
                {ownedDongles.map((dongle) => (
                  <MenuItem key={dongle.id} value={dongle.id}>
                    {dongle.device_id} ({dongle.ownership_state})
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                label="Dongle B"
                value={createPayload.b}
                onChange={(e) => setCreatePayload((prev) => ({ ...prev, b: e.target.value }))}
                fullWidth
                required
                data-testid="group-dongle-b"
              >
                {ownedDongles.map((dongle) => (
                  <MenuItem key={dongle.id} value={dongle.id}>
                    {dongle.device_id} ({dongle.ownership_state})
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
          <PrimaryButton type="submit" disabled={creating} data-testid="group-create-submit">
            {creating ? "Creating..." : "Create group"}
          </PrimaryButton>
        </Stack>
      </InfoCard>

      {loading ? (
        <Typography>Loading groups...</Typography>
      ) : groups.length === 0 ? (
        <Alert severity="info">No groups created yet.</Alert>
      ) : (
        <Grid container spacing={2} data-testid="groups-list">
          {groups.map((group) => {
            const backlogA = group.buffered_frames_a_to_b ?? 0;
            const backlogB = group.buffered_frames_b_to_a ?? 0;
            const degraded = Boolean(group.offline_side) || group.mode.toLowerCase().includes("degrad");
            return (
              <Grid key={group.id} item xs={12} md={6}>
                <InfoCard title={`Group ${group.id.slice(0, 8)}`}>
                  <Stack spacing={1}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
                    >
                      <Typography variant="body2">Mode:</Typography>
                      <StatusChip label={group.mode} tone={modeTone(group.mode) as any} />
                      {degraded ? (
                        <StatusChip
                          label={`Degraded${group.offline_side ? ` (${group.offline_side} offline)` : ""}`}
                          tone="warning"
                        />
                      ) : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Dongle A: {group.dongle_a_id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Dongle B: {group.dongle_b_id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Buffer A→B: {backlogA} | Buffer B→A: {backlogB}
                    </Typography>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      pt={1}
                      flexWrap="wrap"
                      sx={{ alignItems: { xs: "stretch", sm: "center" } }}
                    >
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleActivate(group.id, "activate")}
                        disabled={group.mode === "ACTIVE"}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                      >
                        Activate
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => handleActivate(group.id, "deactivate")}
                        disabled={group.mode === "INACTIVE"}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                      >
                        Deactivate
                      </Button>
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => navigate(`/console?group=${group.id}`)}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                      >
                        Open console
                      </Button>
                    </Stack>
                  </Stack>
                </InfoCard>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Stack>
  );
};
