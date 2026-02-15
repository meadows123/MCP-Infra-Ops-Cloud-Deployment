FROM node:22.12-alpine

WORKDIR /app

# Copy all files first (needed for npm prepare script)
COPY . .

# Install dependencies (this will also run the prepare script which builds)
RUN npm install --ignore-scripts

# Build TypeScript manually
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

ENTRYPOINT ["node", "dist/http_server.js"]