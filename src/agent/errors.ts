// A stable error class for every failure the agent surfaces, so a log line names the cause rather than "Error".
import Anthropic from '@anthropic-ai/sdk';

export function errorClass(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'AuthError';
  if (err instanceof Anthropic.RateLimitError) return 'RateLimitError';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'TimeoutError';
  if (err instanceof Anthropic.APIConnectionError) return 'UpstreamUnavailable';
  if (err instanceof Anthropic.APIError) return 'UpstreamError';
  return err instanceof Error ? err.name : 'UnknownError';
}

// The SDK's error messages never contain the key; only the class and message are ever shown.
export function describe(err: unknown): { error_class: string; message: string } {
  return { error_class: errorClass(err), message: err instanceof Error ? err.message : String(err) };
}
