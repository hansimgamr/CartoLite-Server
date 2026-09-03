# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# Two optional deployment settings, both plain build args because neither is a
# credential:
#   VITE_CARTO_TILE_BASE      same-origin path of a reverse proxy that appends
#                             the CARTO key server-side. When set, no key is
#                             compiled in and the browser never sees one.
#   VITE_STATUS_CONSOLE_ORIGIN  companion status console to link to, if any.
ARG VITE_CARTO_TILE_BASE=""
ARG VITE_STATUS_CONSOLE_ORIGIN=""
# CARTO issues this key for direct browser tile URLs. The secret mount keeps its
# value out of source, build logs, and image metadata; it remains client-visible.
# Leave the secret unset when VITE_CARTO_TILE_BASE is used.
RUN --mount=type=secret,id=carto_basemap_api_key,required=false \
    VITE_CARTO_BASEMAP_API_KEY="$(cat /run/secrets/carto_basemap_api_key 2>/dev/null || true)" \
    VITE_CARTO_TILE_BASE="$VITE_CARTO_TILE_BASE" \
    VITE_STATUS_CONSOLE_ORIGIN="$VITE_STATUS_CONSOLE_ORIGIN" \
    npm run build

FROM --platform=$BUILDPLATFORM golang:1.25.13-bookworm AS go-build
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY backend/go.mod backend/go.sum ./backend/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd backend && go mod download && go mod verify
COPY backend/ ./backend/
COPY --from=web-build /src/web/dist/ ./backend/internal/httpapi/static/
RUN install -d -m 0750 -o 65532 -g 65532 /tmp/cartolite-data
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd backend && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
      -trimpath \
      -ldflags="-s -w -X main.version=${APP_VERSION} -X main.gitSHA=${GIT_SHA}" \
      -o /out/cartolite ./cmd/cartolite

FROM scratch
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
LABEL org.opencontainers.image.title="CartoLite Server" \
      org.opencontainers.image.description="Self-hosted privacy-safe live MeshCore traffic map" \
      org.opencontainers.image.source="https://github.com/n30nex/CartoLite-Server" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.licenses="MIT"
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=go-build --chown=65532:65532 /tmp/cartolite-data /data
COPY --from=go-build /out/cartolite /cartolite
USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/cartolite", "healthcheck", "http://127.0.0.1:8080/healthz"]
ENTRYPOINT ["/cartolite"]
