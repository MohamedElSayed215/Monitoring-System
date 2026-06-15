const express = require("express");
const client = require("prom-client");

const app = express();
const PORT = process.env.PORT || 3000;

// Create a registry
const register = new client.Registry();

// Collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom Counter
const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

register.registerMetric(httpRequests);

// Application endpoint
app.get("/", (req, res) => {
  httpRequests.inc({
    method: req.method,
    route: req.route.path,
    status: "200",
  });

  res.send("Hello from Kubernetes Monitoring!");
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`Application running on port ${PORT}`);
});
