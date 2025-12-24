import { InfoCard, PrimaryButton, StatusChip } from "@dashboard/ui";
import {
  Alert,
  Box,
  Button,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { DongleSummary } from "@dashboard/shared";
import { useEffect, useState } from "react";
import { ApiError, api, type AdminUser, type AuditLogEntry } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export const AdminPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [dongles, setDongles] = useState<DongleSummary[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ action: "", from: "", to: "" });
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setActionMessage(null);
    const [usersResult, donglesResult] = await Promise.allSettled([
      api.adminListUsers(),
      api.listDongles(),
    ]);
    if (usersResult.status === "fulfilled") {
      setUsers(usersResult.value.users);
    } else if (usersResult.reason) {
      const err = usersResult.reason;
      setError(err instanceof ApiError ? err.message : "Failed to load users.");
    }
    if (donglesResult.status === "fulfilled") {
      setDongles(donglesResult.value.dongles);
    } else if (donglesResult.reason) {
      const err = donglesResult.reason;
      setError(err instanceof ApiError ? err.message : "Failed to load dongles.");
    }
    await fetchLogs();
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const fetchLogs = async () => {
    try {
      const { logs } = await api.adminListAuditLogs({
        action: filters.action || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      });
      setLogs(logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load audit logs.");
    }
  };

  const disableUser = async (userId: string) => {
    setActionMessage(null);
    try {
      const { user } = await api.adminDisableUser(userId);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      setActionMessage(`User ${user.email} disabled.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to disable user.");
    }
  };

  const forceUnpair = async (dongleId: string) => {
    setActionMessage(null);
    try {
      await api.adminForceUnpair(dongleId);
      setActionMessage("Dongle force-unpaired.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to force unpair dongle.");
    }
  };

  if (!user || user.role !== "super_admin") {
    return <Alert severity="error">You must be a super admin to view admin tools.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Admin tools
        </Typography>
        <Typography color="text.secondary">
          Super admin operations: disable users, force unpair dongles, and inspect audit logs.
        </Typography>
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <InfoCard title="Users">
            {loading ? (
              <Typography>Loading users...</Typography>
            ) : users.length === 0 ? (
              <Alert severity="info">No users found.</Alert>
            ) : (
              <Stack spacing={1}>
                {users.map((u) => (
                  <Stack
                    key={u.id}
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Stack spacing={0.5}>
                      <Typography variant="body2">{u.email}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Role: {u.role}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusChip
                        label={u.status}
                        tone={u.status === "active" ? "success" : "warning"}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => disableUser(u.id)}
                        disabled={u.status !== "active"}
                      >
                        Disable
                      </Button>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </InfoCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <InfoCard title="Dongles">
            {loading ? (
              <Typography>Loading dongles...</Typography>
            ) : dongles.length === 0 ? (
              <Alert severity="info">No dongles available.</Alert>
            ) : (
              <Stack spacing={1}>
                {dongles.map((dongle) => (
                  <Stack
                    key={dongle.id}
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Stack spacing={0.5}>
                      <Typography variant="body2">{dongle.device_id}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Ownership: {dongle.ownership_state}
                      </Typography>
                    </Stack>
                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      onClick={() => forceUnpair(dongle.id)}
                    >
                      Force unpair
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
          </InfoCard>
        </Grid>
      </Grid>

      <InfoCard title="Audit logs">
        <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                label="Action contains"
                value={filters.action}
                onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                label="From (ISO)"
                value={filters.from}
                onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
                placeholder="2025-12-22T10:00:00Z"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                label="To (ISO)"
                value={filters.to}
                onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
                placeholder="2025-12-22T12:00:00Z"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={2} display="flex" alignItems="center">
              <PrimaryButton onClick={fetchLogs}>Apply filters</PrimaryButton>
            </Grid>
          </Grid>

          {logs.length === 0 ? (
            <Alert severity="info">No audit entries match the filters.</Alert>
          ) : (
            <Stack spacing={1} sx={{ maxHeight: 320, overflow: "auto" }}>
              {logs.map((log) => (
                <Box key={log.id} sx={{ borderBottom: "1px solid rgba(255,255,255,0.06)", pb: 1 }}>
                  <Typography variant="body2">
                    {log.action} — target {log.target_type}:{log.target_id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    At {new Date(log.created_at).toLocaleString()} from {log.ip ?? "n/a"}
                  </Typography>
                  {log.details ? (
                    <Typography variant="caption" display="block">
                      Details: {JSON.stringify(log.details)}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </InfoCard>
    </Stack>
  );
};
