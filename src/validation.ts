import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const contactSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  email: z
    .string()
    .email('Invalid email address')
    .max(255, 'Email must be 255 characters or less'),
  phone: z
    .string()
    .min(1, 'Phone is required')
    .max(50, 'Phone must be 50 characters or less'),
  message: z
    .string()
    .min(1, 'Message is required')
    .max(5000, 'Message must be 5000 characters or less'),
});

export type ContactInput = z.infer<typeof contactSchema>;

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
