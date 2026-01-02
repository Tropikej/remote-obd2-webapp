FROM node:20-slim

WORKDIR /opt/obd2-dashboard

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY apps/dashboard-api/package.json apps/dashboard-api/package.json
COPY apps/dashboard-e2e/package.json apps/dashboard-e2e/package.json
COPY apps/dashboard-web/package.json apps/dashboard-web/package.json
COPY apps/bridge-agent/package.json apps/bridge-agent/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/remp/package.json packages/remp/package.json
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run build --workspace apps/dashboard-web

CMD ["sh", "-c", "mkdir -p /shared && cp -R /opt/obd2-dashboard/apps/dashboard-web/dist/. /shared && tail -f /dev/null"]
