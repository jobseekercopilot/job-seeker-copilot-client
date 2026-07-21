FROM node:20-alpine AS build

WORKDIR /app

# OpenAPI Generator is checksum-pinned and runs only while creating the
# ignored TypeScript clients; Java is not copied into the runtime image.
RUN apk add --no-cache openjdk17-jre-headless

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

EXPOSE 3000

CMD ["npm", "run", "serve:ssr:job-seeker-copilot-client"]
