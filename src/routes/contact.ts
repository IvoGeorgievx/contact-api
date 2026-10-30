import { Router, json } from 'express';
import { createHmac } from 'node:crypto';
import { config } from '../config';
import { contactSchema, validate, type ContactInput } from '../validation';
import { requireAllowedOrigin, contactLimiter } from '../security';
import { insertSubmission, updateTelegramStatus } from '../db';
import { sendTelegramNotification } from '../telegram';

const router = Router();

router.post(
  '/contact',
  contactLimiter,
  requireAllowedOrigin,
  json({ limit: '10kb' }),
  validate(contactSchema),
  async (req, res, next) => {
    let id: number;
    const { name, email, phone, message, source } = req.body as ContactInput;

    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const ipHash = createHmac('sha256', config.ipHashSecret).update(ip).digest('hex');
      id = insertSubmission({
        name, email, phone, message, source,
        ip_hash: ipHash,
        user_agent: req.headers['user-agent'] || null,
        turnstile_success: false,
        telegram_status: 'sending',
        telegram_error: null,
      });
    } catch (err) {
      next(err);
      return;
    }

    try {
      const result = await sendTelegramNotification({ name, email, phone, message, source, submissionId: id });
      updateTelegramStatus(id, result.success ? 'sent' : 'failed', result.error ?? null);
      if (!result.success) console.error('notification_failed', { submissionId: id });
    } catch {
      // The receipt is already durable: a bookkeeping failure must not invite a duplicate submission.
      console.error('notification_status_failed', { submissionId: id });
    }

    res.status(202).json({
      success: true,
      message: 'Message received',
    });
  },
);

export default router;
