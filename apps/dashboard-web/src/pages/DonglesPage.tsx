import { InfoCard, StatusChip } from "@dashboard/ui";
import { Alert, Box, Button, Grid, Stack, Typography } from "@mui/material";
import type { DongleSummary } from "@dashboard/shared";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client";

const isOnline = (lastSeen: string | null) => {
  if (!lastSeen) return false;
  const last = new Date(lastSeen).getTime();
  return Date.now() - last < 2 * 60 * 1000;
};

export const DonglesPage = () => {
  const navigate = useNavigate();
  const [dongles, setDongles] = useState<DongleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listDongles();
      setDongles(data.dongles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load dongles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Dongles
        </Typography>
        <Typography color="text.secondary">
          View discovered dongles, ownership state, and jump into pairing or configuration.
        </Typography>
      </Box>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Button variant="contained" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <Button variant="outlined" onClick={() => navigate("/groups")}>
          Manage Groups
        </Button>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? (
        <Typography>Loading dongles...</Typography>
      ) : dongles.length === 0 ? (
        <Alert severity="info">No dongles discovered yet.</Alert>
      ) : (
        <Grid container spacing={2}>
          {dongles.map((dongle) => {
            const online = isOnline(dongle.last_seen_at);
            return (
              <Grid item xs={12} md={6} key={dongle.id}>
                <InfoCard title={dongle.device_id}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2">Ownership:</Typography>
                      <StatusChip
                        label={dongle.ownership_state}
                        tone={dongle.ownership_state.includes("ACTIVE") ? "success" : "warning"}
                      />
                      <StatusChip label={online ? "Online" : "Offline"} tone={online ? "success" : "warning"} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      LAN: {dongle.lan_ip ?? "unknown"} | UDP: {dongle.udp_port ?? "?"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Last seen:{" "}
                      {dongle.last_seen_at ? new Date(dongle.last_seen_at).toLocaleString() : "never"}
                    </Typography>
                    <Stack direction="row" spacing={1} pt={1} flexWrap="wrap">
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => navigate(`/dongles/${dongle.id}`)}
                      >
                        View
                      </Button>
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => navigate(`/console?dongle=${dongle.id}`)}
                      >
                        Console
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
