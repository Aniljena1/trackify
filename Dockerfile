FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server/ server/
COPY --from=client /app/client/dist client/dist
EXPOSE 4000
# Schema is applied on boot. Seed demo data once with: docker compose exec app node server/src/seed.js --force
CMD ["node", "server/src/index.js"]
