FROM node:22-alpine

WORKDIR /app

# Copy all files first
COPY . .

# Install dependencies (skip prepare script)
RUN npm install --ignore-scripts

# Build TypeScript manually
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

ENTRYPOINT ["node", "dist/http_server.js"]