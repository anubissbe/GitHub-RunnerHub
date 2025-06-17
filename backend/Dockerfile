FROM node:22-alpine

# Install docker-cli for Docker socket access
RUN apk add --no-cache docker-cli curl

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8300

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8300/health || exit 1

# Run as root to allow Docker socket access
CMD ["node", "server.js"]