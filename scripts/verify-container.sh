#!/usr/bin/env sh
set -eu

image_name=${1:-job-seeker-copilot-client:verify}
container_name="client-runtime-verify-$$"

cleanup() {
    docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker build --tag "$image_name" .
test "$(docker image inspect --format '{{.Config.User}}' "$image_name")" = "1000:1000"
test "$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' "$image_name")" != "null"

docker run --detach --name "$container_name" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
    "$image_name" >/dev/null

attempt=0
while [ "$attempt" -lt 60 ]; do
    state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_name")
    if [ "$state" = "running healthy" ]; then break; fi
    if [ "${state%% *}" != "running" ]; then docker logs "$container_name"; exit 1; fi
    attempt=$((attempt + 1))
    sleep 1
done

test "$(docker inspect --format '{{.State.Health.Status}}' "$container_name")" = "healthy"
docker exec "$container_name" sh -c \
    'test "$(id -u)" = 1000 && test "$(id -g)" = 1000 && test ! -e /app/node_modules && test ! -e /usr/local/lib/node_modules/npm && ! command -v npm >/dev/null'

docker stop --time 15 "$container_name" >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$container_name")" = "0"
docker logs "$container_name" 2>&1 | grep -F 'Graceful shutdown complete after SIGTERM' >/dev/null

echo "runtime container policy, health and graceful shutdown: passed"
