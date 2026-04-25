# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

FROM deps AS ui-build
ARG VITE_RPC_URL
ARG VITE_CHAIN_ID=11155111
ARG VITE_RELAYER_URL=/api
ARG VITE_CONTRACT_ADDRESS=

ENV VITE_RPC_URL=${VITE_RPC_URL}
ENV VITE_CHAIN_ID=${VITE_CHAIN_ID}
ENV VITE_RELAYER_URL=${VITE_RELAYER_URL}
ENV VITE_CONTRACT_ADDRESS=${VITE_CONTRACT_ADDRESS}

RUN pnpm run build --mode sepolia

FROM nginx:1.27-alpine AS ui-runtime
COPY docker/nginx.sepolia.conf /etc/nginx/conf.d/default.conf
COPY --from=ui-build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

FROM deps AS relayer-runtime
ENV NODE_ENV=production

EXPOSE 8787
CMD ["node", "relayer/server.cjs"]
