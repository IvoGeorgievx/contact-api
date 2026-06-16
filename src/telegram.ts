import { config } from './config';

const TELEGRAM_TIMEOUT = 6000;

export interface TelegramPayload {
  name: string;
  email: string;
  phone: string;
  message: string;
  submissionId: number;
}

export async function sendTelegramNotification(
  payload: TelegramPayload,
): Promise<{ success: boolean; error?: string }> {
  const text = [
    '<b>New Contact Form Submission</b>',
    '',
    `<b>Name:</b> ${escapeHtml(payload.name)}`,
    `<b>Email:</b> ${escapeHtml(payload.email)}`,
    `<b>Phone:</b> ${escapeHtml(payload.phone)}`,
    `<b>Message:</b>`,
    escapeHtml(payload.message),
    '',
    `Submission #${payload.submissionId}`,
    new Date().toISOString(),
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text,
          parse_mode: 'HTML',
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text();
      return { success: false, error: `Telegram API error: ${response.status} ${body}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
