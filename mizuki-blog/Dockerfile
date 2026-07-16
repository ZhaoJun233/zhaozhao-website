FROM node:24.14.1-alpine3.23 AS dependencies

WORKDIR /app
RUN mkdir /site && chown node:node /app /site

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

FROM nginx:1.29.3-alpine3.22-slim AS dynamic

COPY docker/nginx.dynamic.conf /etc/nginx/nginx.conf

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]

FROM nginx:1.29.3-alpine3.22-slim AS production

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
