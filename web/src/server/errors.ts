export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = () => new AppError(401, "unauthorized", "Sign in required");
// Used for both "no access" and "does not exist" so IDs cannot be probed.
export const notFound = (what = "Not found") => new AppError(404, "not_found", what);
export const forbidden = (message = "You do not have permission to do that") =>
  new AppError(403, "forbidden", message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);
