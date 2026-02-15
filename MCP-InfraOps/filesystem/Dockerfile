FROM node:22.12-alpine AS builder
WORKDIR /app
COPY . /app
RUN npm install
RUN npm run build

FROM node:22-alpine AS release
WORKDIR /app

# Create projects directory with correct permissions
RUN mkdir -p /projects
RUN chown -R node:node /projects
VOLUME /projects

# Copy files and set permissions
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

# Change ownership of the app directory
RUN chown -R node:node /app

ENV NODE_ENV=production
ENV PROJECTS_PATH=/projects

# Switch to non-root user AFTER npm operations
USER node

# Install dependencies as non-root user
RUN npm ci --ignore-scripts --omit-dev

# Expose port for HTTP server
EXPOSE 3000

CMD ["node", "/app/dist/http_server.js"]