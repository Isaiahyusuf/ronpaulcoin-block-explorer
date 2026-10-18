# Builds the address-indexer worker. The build context is assembled by
# indexer/worker/deploy.sh: indexer/*.ts plus lib/rawblock.ts, laid out as in the repo.
FROM node:24-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm pkg set type=module && npm install --omit=dev pg@8
COPY indexer ./indexer
COPY lib ./lib
USER node
CMD ["node", "--experimental-strip-types", "indexer/cli.ts"]
