# Kubernetes (example)

These manifests are **templates**: replace the image reference and create the secret before applying.

```bash
kubectl create secret generic news-api-secrets \
  --from-literal=gnews-api-key=YOUR_GNEWS_KEY

kubectl apply -f deploy/k8s/
```

Requires a container image built from the repository `Dockerfile` (for example `ghcr.io/your-org/news-api:1.0.0`).

Tune `replicas`, resource requests/limits, and `TRUST_PROXY` for your ingress controller.

For a **shared cache** across replicas, run Redis (or a managed cache) and set `REDIS_URL` on the Deployment env.
