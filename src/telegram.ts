import { config } from './config';

const TELEGRAM_TIMEOUT = 6000;

export interface TelegramPayload {
  name: string;
  email: string;
  phone: string;
  message: string;
  source: 'main-website' | 'studio';
  submissionId: number;
}

export async function sendTelegramNotification(
  payload: TelegramPayload,
): Promise<{ success: boolean; error?: string }> {
  const details = [
    ['Source', payload.source], ['Name', payload.name], ['Email', payload.email], ['Phone', payload.phone],
  ];
  const timestamp = new Date().toISOString();
  const plainHeader = ['New Contact Form Submission', ...details.map(([label, value]) => `${label}: ${value}`),
    `Submission #${payload.submissionId}`, timestamp].join('\n');
  // Budget rendered UTF-16 units conservatively, including per-part labels; HTML is escaped only after splitting.
  const chunkLimit = 4096 - plainHeader.length - 64;
  if (chunkLimit < 2) return { success: false, error: 'telegram_metadata_too_long' };
  const chunks: string[] = [];
  let chunk = '';
  for (const character of payload.message) {
    if (chunk.length + character.length > chunkLimit) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  chunks.push(chunk);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT);
  let delivered = 0;
  try {
    for (const [index, part] of chunks.entries()) {
      const text = ['<b>New Contact Form Submission</b>',
        ...details.map(([label, value]) => `<b>${label}:</b> ${escapeHtml(value)}`),
        `Submission #${payload.submissionId}`, timestamp, `Part ${index + 1}/${chunks.length}`, '',
        '<b>Message:</b>', escapeHtml(part)].join('\n');
      const response = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: 'HTML' }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return { success: false, error: `telegram_http_${response.status}; delivered=${delivered}/${chunks.length}` };
      }
      const result = await response.json() as { ok?: boolean };
      if (result.ok !== true) {
        return { success: false, error: `telegram_api_failed; delivered=${delivered}/${chunks.length}` };
      }
      delivered++;
    }

    return { success: true };
  } catch {
    return {
      success: false,
      error: `telegram_${controller.signal.aborted ? 'timeout' : 'request_failed'}; delivered=${delivered}/${chunks.length}`,
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
