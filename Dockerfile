FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY . .

# NODE_ENV=production חייב להיות מוגדר רק אחרי הבנייה — לפניה npm צריך להתקין גם
# devDependencies (prisma, typescript) כדי ש-build יעבוד בכלל.
RUN npm install --workspaces --include-workspace-root
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start"]
