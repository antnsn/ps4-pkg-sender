FROM node:25-alpine

WORKDIR /opt/apps/pkg_sender

# Install curl for health checks
RUN apk add --no-cache curl

COPY package.json ./
RUN npm install --only=production

COPY src src

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "src/app.js"]
