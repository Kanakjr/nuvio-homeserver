FROM node:22-alpine AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code and configuration
COPY . .

# Build production bundle
RUN npm run build

# Stage 2: Serve with Nginx Alpine + lightweight Node.js for sync
FROM nginx:alpine

RUN apk add --no-cache nodejs

# Remove default nginx configs
RUN rm -rf /etc/nginx/conf.d/*

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy server daemon & entrypoint
WORKDIR /app
COPY server.cjs /app/server.cjs
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 80

CMD ["/app/entrypoint.sh"]
