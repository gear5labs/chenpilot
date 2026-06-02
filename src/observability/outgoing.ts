import { buildCorrelationHeaders } from "./context";

export function injectTracingHeaders(
  existing: Record<string, string> = {}
): Record<string, string> {
  const trace = buildCorrelationHeaders();
  return { ...existing, ...trace };
}

export default injectTracingHeaders;
