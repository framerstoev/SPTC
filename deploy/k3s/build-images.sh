#!/usr/bin/env bash
# Run in the extracted handoff root on an authorized Linux-capable Docker builder.
set -euo pipefail
: "${FRONTEND_VERSION:?set version from RELEASE.txt}"
: "${BACKEND_VERSION:?set version from RELEASE.txt}"
docker buildx version
docker info --format '{{.OSType}}' | grep -qx linux
docker buildx build --platform linux/amd64 --load \
  --tag "ghcr.io/framerstoev/sptc-resilience-frontend:${FRONTEND_VERSION}" docker/frontend
docker buildx build --platform linux/amd64 --load \
  --tag "ghcr.io/framerstoev/sptc-resilience-backend:${BACKEND_VERSION}" docker/backend
for ref in "ghcr.io/framerstoev/sptc-resilience-frontend:${FRONTEND_VERSION}" \
           "ghcr.io/framerstoev/sptc-resilience-backend:${BACKEND_VERSION}"; do
  docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}} {{.Size}}'
  test "$(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}')" = linux/amd64
done
printf '%s\n' 'Built locally. Complete container/browser/model smoke tests before an explicit registry push.'
