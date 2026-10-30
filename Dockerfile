ARG NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
FROM ${NODE_IMAGE} AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM build AS test
COPY tests/ ./tests/
RUN npm test

FROM test AS production-deps
RUN npm prune --omit=dev --ignore-scripts

FROM ${NODE_IMAGE}
WORKDIR /app

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const r=require('node:http').get({host:'127.0.0.1',port:Number(process.env.PORT||3000),path:'/health',timeout:2000},s=>{s.resume();process.exit(s.statusCode===200?0:1)});r.on('timeout',()=>{r.destroy();process.exit(1)});r.on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
