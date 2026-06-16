# node-docker-app

A minimal Node.js (Express) app, containerized with Docker, with a GitHub Actions
workflow that builds the image and pushes it to Docker Hub on every push to `main`.
A sample Kubernetes Deployment/Service is included for deploying the resulting
image to a local cluster (e.g. minikube, kind, k3d). Prometheus stack is used to 
monitor the cluster's condition with offering solid analysis using grafana dashboards.


## Project structure

```
.
├── server.js                          # Express app (/, /health, /metrics)
├── package.json
├── Dockerfile                         # multi-stage build
├── .dockerignore
├── .github/workflows/docker-publish.yml
└── k8s/
    ├── deployment.yaml
    ├── service.yaml
    |   app-alert.yaml
    |   alertmanager-values.yaml
    └── servicemonitor.yaml            # optional, for Prometheus Operator
```

## 1. Run locally (no Docker)

```bash
npm install
npm start
# visit http://localhost:3000 and http://localhost:3000/health
```

## 2. Build and run with Docker

```bash
docker build -t node-docker-app .
docker run -p 3000:3000 node-docker-app
```

## 3. Push the project to GitHub

```bash
git init
git add .
git commit -m "Initial commit: node app + docker + workflow"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 4. Configure GitHub Actions to push to Docker Hub

The workflow at `.github/workflows/docker-publish.yml` runs on every push to
`main` (and can also be triggered manually via "Run workflow").

It needs two repository secrets:

1. Go to your repo on GitHub → **Settings → Secrets and variables → Actions → New repository secret**
2. Add:
   - `DOCKERHUB_USERNAME` — your Docker Hub username
   - `DOCKERHUB_TOKEN` — a Docker Hub access token (Docker Hub → Account Settings → Security → New Access Token; don't use your password)

Once both secrets are set, push to `main` and the workflow will:
- build the image using Buildx (with layer caching)
- push it as:
  - `<DOCKERHUB_USERNAME>/node-docker-app:latest`
  - `<DOCKERHUB_USERNAME>/node-docker-app:<commit-sha>`

## 5. Deploy to your local Kubernetes cluster

Edit `k8s/app-files/deployment.yaml` and replace the image with your own:

```yaml
image: <your-dockerhub-username>/node-docker-app:latest
```

Then apply the manifests:

```bash
kubectl apply -f k8s/app-files/deployment.yaml
kubectl apply -f k8s/app-files/service.yaml
```

If you're using minikube/kind and want to access the service:

```bash
kubectl get svc node-docker-app
# NodePort is set to 30080 in service.yaml
minikube service node-docker-app   # for minikube
```

## 6. Prometheus monitoring

The app exposes a `/metrics` endpoint (via `prom-client`) with default Node.js
process metrics (CPU, memory, event loop lag, GC) plus two custom metrics:
`http_request_duration_seconds` and `http_requests_total`, both labeled by
method, route, and status code.

```bash
curl http://localhost:3000/metrics
```

There are two ways to let Prometheus discover this endpoint in Kubernetes —
use whichever matches how Prometheus is set up on your cluster:

**A. Plain Prometheus with annotation-based discovery**

`k8s/app-files/deployment.yaml` already includes these pod annotations:

```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "3000"
prometheus.io/path: "/metrics"
```

This works if your `prometheus.yml` has a `kubernetes_sd_configs` job with
relabeling rules that respect these annotations (the standard example from
the Prometheus docs / most "prometheus on kubernetes" tutorials). No further
action needed beyond applying `deployment.yaml`.

**B. Prometheus Operator / kube-prometheus-stack**

If Prometheus is managed by the Prometheus Operator, apply the included
`ServiceMonitor`:

```bash
kubectl apply -f k8s/app-files/servicemonitor.yaml
```

This tells the Operator to scrape the `node-docker-app` Service's `http`
port at `/metrics` every 15s. Make sure the `ServiceMonitor`'s namespace is
one your Prometheus instance is configured to watch (or adjust
`spec.serviceMonitorSelector` / namespace selectors on the Prometheus CR
accordingly).

## Notes

- The Dockerfile uses a multi-stage build with `node:20-alpine` and runs the
  app as a non-root `node` user.
- `/health` is used for the Docker `HEALTHCHECK` as well as the Kubernetes
  liveness/readiness probes.
- If you rename the image (currently `node-docker-app`), update the tag names
  in `.github/workflows/docker-publish.yml` and `k8s/app-files/deployment.yaml` to match.
