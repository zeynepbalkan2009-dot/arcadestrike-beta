/**
 * Minimal metrics stub — replace with Prometheus/OpenTelemetry in production.
 */
const counters: Record<string, number> = {};
const gauges: Record<string, number> = {};

export const metrics = {
  increment(key: string, value = 1): void {
    counters[key] = (counters[key] ?? 0) + value;
  },
  gauge(key: string, value: number): void {
    gauges[key] = value;
  },
  getSnapshot(): { counters: typeof counters; gauges: typeof gauges } {
    return { counters: { ...counters }, gauges: { ...gauges } };
  },
};
