import { z, ZodTypeAny } from 'zod';

/** An error that maps directly to an HTTP response: { error: { code, message, details } }. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** A failed call to another service. kind tells the caller whether the outcome is known. */
export class UpstreamError extends Error {
  constructor(
    public target: string,
    public kind: 'timeout' | 'unavailable' | 'http',
    message: string,
    public status?: number,
    public body?: any,
  ) {
    super(message);
  }
  get code(): string | undefined {
    return this.body?.error?.code;
  }
}

/** Validate input with zod; failures become 400 VALIDATION_ERROR with per-field details. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown, rootField = '(body)'): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((i) => ({ field: i.path.join('.') || rootField, message: i.message })),
    );
  }
  return result.data;
}
