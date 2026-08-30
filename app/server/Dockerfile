FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server ./server
USER node
EXPOSE 3000
CMD ["node", "server/src/index.js"]
