FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY lib ./lib
COPY data ./data
COPY public ./public
COPY scripts ./scripts

ENV PORT=9090
EXPOSE 9090

RUN chown -R node:node /app
USER node
CMD ["node", "server.mjs"]
