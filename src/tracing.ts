import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;
const tracer = trace.getTracer("news-api");

function stableErrorType(error: unknown, fallback = "unknown_error"): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(code)) {
      return code;
    }
  }
  if (error instanceof Error && error.name && /^[a-z0-9_.-]{1,64}$/i.test(error.name)) {
    return error.name;
  }
  return fallback;
}

/**
 * Record only a stable error classification. Exception messages can contain
 * request data, provider URLs, or other values that do not belong in traces.
 */
export function markSpanError(span: Span, error: unknown, fallback = "unknown_error"): void {
  const type = stableErrorType(error, fallback);
  span.setAttribute("error.type", type);
  span.recordException({ name: type, message: type });
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T> | T
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      markSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

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
