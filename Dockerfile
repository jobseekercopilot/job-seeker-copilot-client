FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

WORKDIR /app

# OpenAPI Generator is checksum-pinned and runs only while creating the
# ignored TypeScript clients; Java is not copied into the runtime image.
RUN apk add --no-cache openjdk17-jre-headless=17.0.20_p8-r0

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

# Package managers and build tools are not needed by the bundled SSR output.
# Removing them also keeps their dependency graph outside the attack surface of
# the production image.
RUN rm -rf /usr/local/lib/node_modules/npm \
        /usr/local/lib/node_modules/corepack \
        /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
        /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

COPY --chown=1000:1000 --from=build /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

USER 1000:1000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD ["node", "-e", "const http=require('node:http');const request=http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/'},response=>{response.resume();process.exit(response.statusCode<500?0:1)});request.setTimeout(2000,()=>request.destroy());request.on('error',()=>process.exit(1))"]

CMD ["node", "dist/job-seeker-copilot-client/server/server.mjs"]
