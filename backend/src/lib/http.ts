import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './x402.js';

/** Wraps an async handler: Zod errors -> 400, HttpError -> its status, else 500. */
export function handle<R extends Request>(fn: (req: R, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    fn(req as R, res).catch((error: unknown) => {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: error.errors[0]?.message || 'Validation failed',
          details: error.errors,
        });
      }
      if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, error: error.message, code: error.code });
      }
      console.error(error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    });
  };
}
