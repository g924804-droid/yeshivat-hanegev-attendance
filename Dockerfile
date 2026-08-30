FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app
COPY . .

RUN npm install --workspaces --include-workspace-root
RUN npm run build

EXPOSE 4000
CMD ["npm", "run", "start"]
