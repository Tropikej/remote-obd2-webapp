This directory holds Nginx configuration for the dashboard API and web app.
Add server blocks and proxy settings here during the ops plan.

When exposing SSE endpoints under `/api/v1/streams/**`, ensure proxy buffering is disabled and timeouts allow long-lived connections. Example stanza:

```
location /api/v1/streams/ {
  proxy_pass http://dashboard-api;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_set_header Host $host;
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  chunked_transfer_encoding off;
}
```

See `infra/nginx/streams.conf` for a ready-to-use server block that applies these settings.
