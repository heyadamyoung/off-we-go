FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Codex is a Rust binary: unlike node, it trusts the SYSTEM certificate store,
# which this slim image ships empty. Without these roots every TLS connection
# to the model fails "UnknownIssuer" and codex retries until it is killed —
# the assistant hangs at "Thinking…" forever.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
# The AI assistant shells out to the Codex CLI. Deliberately unpinned: each
# deploy rebuilds this image, and a new model name needs a CLI new enough to
# know it. The personal login it uses lives on the codex volume, never here.
RUN npm install -g @openai/codex && install -d -o node -g node /data/codex
COPY server ./server
USER node
EXPOSE 3000
CMD ["node", "server/src/index.js"]
