import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;

function resolveTracesUrl(): string | undefined {
  const direct = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (direct) {
    return direct;
  }
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (base) {
    return `${base.replace(/\/$/, "")}/v1/traces`;
  }
  if (process.env.OTEL_TRACING_ENABLED === "1") {
    return "http://127.0.0.1:4318/v1/traces";
  }
  return undefined;
}

export function initTracing(): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return;
  }
  const url = resolveTracesUrl();
  if (!url) {
    return;
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "news-api",
    }),
    traceExporter: new OTLPTraceExporter({ url }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });
  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = undefined;
  }
}
