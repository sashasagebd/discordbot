# ---- build: compile TypeScript and native deps (@discordjs/opus) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
WORKDIR /app
ARG TARGETARCH
# yt-dlp standalone binary. Rebuild the image to pick up a new release;
# YouTube regularly breaks older versions.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && if [ "$TARGETARCH" = "arm64" ]; then f=yt-dlp_linux_aarch64; else f=yt-dlp_linux; fi \
 && curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$f" \
 && chmod +x /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# yt-dlp needs a JS runtime for YouTube; use the Node already in the image.
RUN printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
