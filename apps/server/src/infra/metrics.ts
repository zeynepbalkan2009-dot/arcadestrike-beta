import { Request, Response, NextFunction } from "express";

type Labels = Record<string, string | number | undefined>;

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge";
  values: Map<string, number>;
}

class MetricsRegistry {
  private metrics = new Map<string, Metric>();

  counter(name: string, help: string, labels: Labels = {}, value = 1): void {
    this.add("counter", name, help, labels, value);
  }

  gauge(name: string, help: string, labels: Labels = {}, value: number): void {
    const metric = this.getOrCreate("gauge", name, help);
    metric.values.set(this.labelKey(labels), value);
  }

  render(): string {
    const lines: string[] = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      for (const [labelKey, value] of metric.values) {
        lines.push(`${metric.name}${labelKey} ${value}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  private add(type: "counter" | "gauge", name: string, help: string, labels: Labels, value: number): void {
    const metric = this.getOrCreate(type, name, help);
    const key = this.labelKey(labels);
    metric.values.set(key, (metric.values.get(key) || 0) + value);
  }

  private getOrCreate(type: "counter" | "gauge", name: string, help: string): Metric {
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { name, help, type, values: new Map() };
      this.metrics.set(name, metric);
    }
    return metric;
  }

  private labelKey(labels: Labels): string {
    const entries = Object.entries(labels)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return "";
    return `{${entries.map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`).join(",")}}`;
  }
}

export const metrics = new MetricsRegistry();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    metrics.counter("arcadestrike_http_requests_total", "Total HTTP requests", {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });
    metrics.gauge("arcadestrike_http_request_duration_ms", "Last HTTP request duration in milliseconds", {
      method: req.method,
      route: req.route?.path || req.path,
    }, Date.now() - start);
  });
  next();
}
