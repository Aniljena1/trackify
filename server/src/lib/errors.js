import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg, details) => new HttpError(409, 'CONFLICT', msg, details);

/** Parse `data` with a zod schema or throw a 400 with field-level details. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw zodToHttp(result.error);
  return result.data;
}

function zodToHttp(err) {
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) err = zodToHttp(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  }
  // Postgres: unique violation / bad uuid / FK violation
  if (err?.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'That value is already in use' } });
  }
  if (err?.code === '22P02') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  }
  if (err?.code === '23503') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Referenced record does not exist or is still in use' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } });
}
