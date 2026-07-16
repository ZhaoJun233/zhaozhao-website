FROM node:24.14.1-alpine3.23 AS dependencies

WORKDIR /app
RUN chown node:node /app

COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci

FROM dependencies AS authoring

COPY --chown=node:node . .

EXPOSE 4321 8081
CMD ["sh", "-c", "rm -f .astro/dev.json && exec npm run dev -- --host 0.0.0.0 --port 4321"]

FROM authoring AS build

ARG PUBLIC_SITE_URL
ARG BUILD_MODE=production
ARG PUBLIC_GISCUS_REPO=
ARG PUBLIC_GISCUS_REPO_ID=
ARG PUBLIC_GISCUS_CATEGORY=
ARG PUBLIC_GISCUS_CATEGORY_ID=
ENV BUILD_MODE=$BUILD_MODE \
    PUBLIC_SITE_URL=$PUBLIC_SITE_URL \
    PUBLIC_GISCUS_REPO=$PUBLIC_GISCUS_REPO \
    PUBLIC_GISCUS_REPO_ID=$PUBLIC_GISCUS_REPO_ID \
    PUBLIC_GISCUS_CATEGORY=$PUBLIC_GISCUS_CATEGORY \
    PUBLIC_GISCUS_CATEGORY_ID=$PUBLIC_GISCUS_CATEGORY_ID

RUN npm run build

FROM build AS runtime

ENV HOST=0.0.0.0 \
    PORT=4321 \
    CONTENT_ROOT=/app/src

USER node
EXPOSE 4321

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server/entry.mjs"]
