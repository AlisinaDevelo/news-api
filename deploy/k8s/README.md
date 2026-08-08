# Kubernetes (example)

Templates for a small production-style layout: **API**, **Redis**, and a **Secret** reference.

## 1. Redis (optional in-cluster cache)

```bash
kubectl apply -f deploy/k8s/redis.yaml
```

For managed Redis (ElastiCache, Memorystore, etc.), skip this file and put the provider URL in the secret below.

## 2. Secret

Never commit real values.

- **Option A:** imperative:

  ```bash
  kubectl create secret generic news-api-secrets \
    --from-literal=gnews-api-key=YOUR_KEY \
    --from-literal=redis-url=redis://redis:6379 \
    --from-literal=client-api-keys=''
  ```

  Omit `redis-url` or use an empty value to use in-memory cache only. Set `client-api-keys` to a comma-separated list if you use `CLIENT_API_KEYS` on the app.

- **Option B:** copy `secret.example.yaml` to a **local** file (gitignored), replace placeholders, then `kubectl apply -f your-secret.yaml`.

## 3. API workload

```bash
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

Replace `image: news-api:latest` in `deployment.yaml` with your registry reference (for example `ghcr.io/your-org/news-api:v1.2.0`).

Tune `replicas`, resources, and `TRUST_PROXY` for your ingress or service mesh.

The readiness probe includes a bounded rate-limit Redis `PING` when `REDIS_URL` is set and rate
limiting is enabled. A Redis outage removes affected pods from Service traffic without failing the
process-only `/health` probe; readiness recovers after ioredis reconnects. When rate limiting is
disabled, Redis is cache-only and remains fail-open for readiness.

## Rollouts and shutdown

The example deployment sets `SHUTDOWN_TIMEOUT_MS=10000` and a 15-second
`terminationGracePeriodSeconds`. Its `preStop` hook sends `SIGTERM` immediately so the pod
returns `503` from `/ready`, then waits briefly for endpoint propagation; Kubernetes may send a
second signal after the hook, and the server handles that idempotently. Keep the grace period
longer than the shutdown timeout when changing either value.

`/health` remains a liveness probe during the drain. `server.close()` lets active requests finish,
while the deadline aborts outbound provider calls and force-closes remaining HTTP connections.
The hook is an example for a service mesh or load balancer that needs propagation time; remove it
when the platform already handles endpoint removal promptly.

## OpenTelemetry

Add env from a ConfigMap or Secret as needed, for example `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at your collector (DaemonSet, sidecar, or SaaS).
