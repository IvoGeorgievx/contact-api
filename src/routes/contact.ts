import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { config } from '../config';
import { contactSchema, validate } from '../validation';
import { requireAllowedOrigin, contactLimiter } from '../security';
import { insertSubmission, updateTelegramStatus } from '../db';
import { sendTelegramNotification } from '../telegram';

const router = Router();

router.post(
  '/contact',
  contactLimiter,
  requireAllowedOrigin,
  validate(contactSchema),
  async (req, res) => {
    const { name, email, phone, message } = req.body;

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ipHash = createHmac('sha256', config.ipHashSecret)
      .update(ip)
      .digest('hex');
    const userAgent = req.headers['user-agent'] || null;

    const id = insertSubmission({
      name,
      email,
      phone,
      message,
      ip_hash: ipHash,
      user_agent: userAgent,
      turnstile_success: false,
      telegram_status: 'sending',
      telegram_error: null,
    });

    const result = await sendTelegramNotification({
      name,
      email,
      phone,
      message,
      submissionId: id,
    });

    if (result.success) {
      updateTelegramStatus(id, 'sent');
    } else {
      updateTelegramStatus(id, 'failed', result.error);
    }

    res.status(202).json({
      success: true,
      message: 'Message received',
    });
  },
);

export default router;
