# Two stages. The base is everything the server runs on — the runtime, ffmpeg,
# the production modules, the assistant's CLI — and the release pipeline
# builds it only when one of those changes, then lays the server over it as
# one layer written straight into the registry (see the images job in
# .github/workflows/deploy-vps.yml). The final stage is that same image built
# by hand: a desk and install.sh get it from `docker compose build`.
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app
# Codex is a Rust binary: unlike node, it trusts the SYSTEM certificate store,
# which this slim image ships empty. Without these roots every TLS connection
# to the model fails "UnknownIssuer" and codex retries until it is killed —
# the assistant hangs at "Thinking…" forever.
# ffmpeg converts what a phone filmed into what every phone can play: an
# iPhone's HEVC-in-.mov is refused by Chrome and Android, so without this half
# a trip cannot watch the other half's videos. ~80MB, and the alternative is
# shipping films most devices decline.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
# The AI assistant shells out to the Codex CLI. Deliberately unpinned: a new
# model name needs a CLI new enough to know it, and the base is rebuilt with
# the newest whenever this file, the dependencies or the node image change —
# a line changed here is enough to ask for one. The personal login it uses
# lives on the codex volume, never here.
# Both /data directories the server writes to, created here and owned by the
# user it runs as. /data itself is root's — docker makes it when it lays the
# mounts down — so a `mkdir /data/<anything>` at runtime is EACCES, and the
# places layer found that out the hard way: the release-index cache could not
# be written, the write threw out of the loader, the loader reported no
# upstream release, the queue was never drained, and every map view came back
# "still loading places here" for ever. One unwritable directory, an empty
# map. The volumes mounted over these two inherit this ownership.
RUN npm install -g @openai/codex \
  && install -d -o node -g node /data/codex /data/places
USER node
EXPOSE 3000
CMD ["node", "server/src/index.js"]

FROM base
COPY server ./server
