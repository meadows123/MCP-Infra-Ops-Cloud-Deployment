FROM node:22.12-alpine AS builder

# Must be entire project because `prepare` script is run during `npm install` and requires all files.
COPY . /app
COPY ./tsconfig.json /tsconfig.json

WORKDIR /app

RUN npm install

RUN npm run build

FROM node:22-alpine AS release

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

ENV NODE_ENV=production

WORKDIR /app

RUN npm install --omit=dev --ignore-scripts

# Use HTTP server instead of stdio
ENTRYPOINT ["node", "dist/http-server.js"]