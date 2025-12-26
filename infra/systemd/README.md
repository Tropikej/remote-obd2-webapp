This directory holds systemd unit files for the dashboard services.

To install the API service on Ubuntu:

1) Copy `obd2-dashboard-api.service` to `/etc/systemd/system/`.
2) Create `/etc/obd2-dashboard.env` (0600) with required env vars (DATABASE_URL, REDIS_URL, SESSION_SECRET, etc.).
3) Set the working directory in the unit to your deploy path (default `/opt/obd2-dashboard/apps/dashboard-api`) if different.
4) Reload and start:

```
sudo systemctl daemon-reload
sudo systemctl enable obd2-dashboard-api
sudo systemctl start obd2-dashboard-api
sudo systemctl status obd2-dashboard-api
```
