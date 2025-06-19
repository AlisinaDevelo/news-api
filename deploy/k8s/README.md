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

## OpenTelemetry

Add env from a ConfigMap or Secret as needed, for example `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at your collector (DaemonSet, sidecar, or SaaS).
