import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';

export function requireAllowedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  next();
}

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

export const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});
