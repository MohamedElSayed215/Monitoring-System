# GitOps Kubernetes Monitoring Stack

A GitOps-driven Kubernetes setup using **ArgoCD** to deploy and manage a **Node.js** application with full observability via **Prometheus** monitoring. Docker images are built and published automatically via **GitHub Actions CI**, and all secrets are managed safely in Git using **Sealed Secrets (kubeseal)**.

---

## Overview

This repository follows a GitOps pattern where ArgoCD continuously syncs cluster state from Git. It includes:

- A **Node.js** application instrumented with **`prom-client`** and **OpenTelemetry**
- **Dockerfile** for containerizing the application
- **GitHub Actions** CI pipeline to build, tag, and push the Docker image
- **Prometheus** monitoring stack (via Helm chart)
- **ServiceMonitor** for scraping Node.js application metrics
- **Alertmanager** with webhook-based alerting
- **Sealed Secrets** for safe, GitOps-compatible secret management
- An **ArgoCD App of Apps** pattern for managing all applications from a single root

---

## Repository Structure

```
.
├── .github/
│   └── workflows/
│       └── ci.yml                    # GitHub Actions — build & push Docker image
├── NodeJsApp/
│   ├── Dockerfile                    # Container image definition
│   ├── app.js                        # Express app with Prometheus + OpenTelemetry instrumentation
│   ├── package.json                  # Dependencies (express, prom-client, @opentelemetry/*)
│   └── package-lock.json
├── app/                              # ArgoCD Application manifests
│   ├── nodejs.yaml                   # ArgoCD App for the Node.js workload
│   ├── prometheus-chart.yaml         # ArgoCD App for Prometheus Helm chart
│   └── prometheus.yaml               # ArgoCD App for Prometheus custom manifests
├── argocd/
│   └── root-argocd.yaml              # Root ArgoCD Application (App of Apps entry point)
├── helm-values/
│   └── prometheus/
│       └── values.yaml               # Custom Helm values for the Prometheus chart
└── manifests/
    ├── nodejs/
    │   ├── nodejs-deploy.yaml        # Node.js Deployment
    │   └── nodejs-service.yaml       # Node.js Service (exposes the app)
    └── prometheus/
        ├── alertmanager-config.yaml  # Alertmanager routing and receiver config
        ├── prometheus-role.yaml      # RBAC Role for Prometheus scraping
        ├── secret-webhook.yaml       # SealedSecret — encrypted webhook credentials
        └── service-monitor.yaml      # ServiceMonitor to scrape Node.js metrics
```

---

## Node.js Application (`NodeJsApp/`)

The application is built with **Express** and exposes metrics for Prometheus scraping using **`prom-client`**. It is also instrumented with **OpenTelemetry** for distributed tracing.

Key dependencies:

| Package | Purpose |
|---|---|
| `express` | HTTP server |
| `prom-client` | Exposes `/metrics` endpoint for Prometheus |
| `@opentelemetry/*` | Distributed tracing instrumentation |

The app is containerized via `NodeJsApp/Dockerfile` and the resulting image is deployed to Kubernetes through `manifests/nodejs/nodejs-deploy.yaml`.

---

## Prerequisites

- Kubernetes cluster (v1.24+)
- [ArgoCD](https://argo-cd.readthedocs.io/) installed in the cluster
- [Sealed Secrets controller](https://github.com/bitnami-labs/sealed-secrets) installed in the cluster
- [kubeseal CLI](https://github.com/bitnami-labs/sealed-secrets#kubeseal) installed locally
- [Helm](https://helm.sh/) v3+
- `kubectl` configured to point at your cluster

---

## CI/CD Pipeline

### CI — GitHub Actions (Build & Push)

Defined in `.github/workflows/ci.yml`. On every push to `main`, GitHub Actions builds the Docker image from `NodeJsApp/Dockerfile` and pushes it to the container registry.

```
Push to main
     │
     ▼
GitHub Actions CI
     │
     ├── Checkout code
     ├── Build Docker image (NodeJsApp/Dockerfile)
     ├── Tag image (e.g. sha-<commit>)
     └── Push to container registry
```

**Required GitHub Secrets** (set under _Settings → Secrets and variables → Actions_):

| Secret | Description |
|---|---|
| `DOCKER_USERNAME` | Registry username |
| `DOCKER_PASSWORD` | Registry password or access token |

> After a new image is pushed, update the image tag in `manifests/nodejs/nodejs-deploy.yaml` and push — ArgoCD will roll out the new version automatically.

### CD — ArgoCD (Deploy)

ArgoCD watches this repository and syncs any manifest changes to the cluster. No manual `kubectl apply` needed after the initial bootstrap.

---

## Secret Management — Sealed Secrets

All secrets are stored as **SealedSecrets** — encrypted Kubernetes objects that are safe to commit to Git. Only the Sealed Secrets controller running inside the cluster can decrypt them.

### How it works

```
Plain Secret (local only, never committed)
        │
        ▼
  kubeseal encrypts with cluster public key
        │
        ▼
SealedSecret (safe to commit) ──► Git ──► ArgoCD ──► cluster
                                                         │
                                          Sealed Secrets controller
                                          decrypts → plain Secret
```

### Creating or updating a secret

1. Create the plain secret locally (never commit this file):

```bash
kubectl create secret generic webhook-secret \
  --from-literal=url='https://hooks.example.com/xyz' \
  --dry-run=client -o yaml > /tmp/webhook-secret.yaml
```

2. Seal it with kubeseal:

```bash
kubeseal --format yaml < /tmp/webhook-secret.yaml > manifests/prometheus/secret-webhook.yaml
```

3. Commit the sealed file:

```bash
git add manifests/prometheus/secret-webhook.yaml
git commit -m "chore: update webhook sealed secret"
git push
```

ArgoCD picks up the change and the controller decrypts it in-cluster. Plaintext never touches Git.

---

## Getting Started

### 1. Install ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

### 2. Install Sealed Secrets Controller

```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets -n kube-system
```

### 3. Bootstrap the App of Apps

```bash
kubectl apply -f argocd/root-argocd.yaml
```

This registers the root app with ArgoCD, which discovers and syncs all child applications under `app/`.

### 4. Verify Sync

```bash
kubectl get applications -n argocd
```

All applications (`nodejs`, `prometheus-chart`, `prometheus`) should reach `Synced` / `Healthy` status.

---

## Components

### Node.js Application

Source code lives in `NodeJsApp/`. The app is containerized with `NodeJsApp/Dockerfile` and deployed via `manifests/nodejs/`. GitHub Actions CI builds and pushes a new image on every merge to `main`.

### Prometheus (Helm)

The Prometheus stack is deployed as a Helm chart. Custom values are maintained in `helm-values/prometheus/values.yaml` and referenced by `app/prometheus-chart.yaml`.

### Prometheus Custom Manifests

| File | Purpose |
|---|---|
| `prometheus-role.yaml` | RBAC permissions for Prometheus to discover and scrape targets |
| `service-monitor.yaml` | Tells Prometheus how to scrape the Node.js `/metrics` endpoint |
| `alertmanager-config.yaml` | Defines alert routing rules and receivers |
| `secret-webhook.yaml` | **SealedSecret** — encrypted webhook credentials for Alertmanager |

---

## Full GitOps Flow

```
Developer pushes code (NodeJsApp/)
        │
        ▼
GitHub Actions CI
  └── builds Docker image from NodeJsApp/Dockerfile
  └── pushes image to registry with commit SHA tag
        │
        ▼
Update image tag in manifests/nodejs/nodejs-deploy.yaml + push
        │
        ▼
ArgoCD detects Git diff
        │
        ▼
Syncs cluster to match Git
  ├── nodejs app        → manifests/nodejs/
  ├── prometheus chart  → helm-values/prometheus/values.yaml
  └── prometheus config → manifests/prometheus/
           └── SealedSecrets decrypted in-cluster by controller
```

---

## Alerting

Alerts are routed through Alertmanager using `alertmanager-config.yaml`. The webhook URL is stored as a SealedSecret in `secret-webhook.yaml` — encrypted at rest in Git, decrypted only inside the cluster.

To update alert routing, edit `manifests/prometheus/alertmanager-config.yaml` and push. ArgoCD applies the change automatically.

---

## Customization

| What to change | Where |
|---|---|
| Application logic | `NodeJsApp/app.js` |
| Container image / build steps | `NodeJsApp/Dockerfile` |
| CI registry / build args | `.github/workflows/ci.yml` |
| Node.js image tag / replicas | `manifests/nodejs/nodejs-deploy.yaml` |
| Prometheus retention / storage | `helm-values/prometheus/values.yaml` |
| Scrape interval / target labels | `manifests/prometheus/service-monitor.yaml` |
| Alert rules & receivers | `manifests/prometheus/alertmanager-config.yaml` |
| Webhook / sensitive credentials | Re-seal with `kubeseal` → `manifests/prometheus/secret-webhook.yaml` |
| ArgoCD sync policy / target cluster | `app/*.yaml` |
