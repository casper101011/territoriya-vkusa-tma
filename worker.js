export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (url.pathname === '/api/send-feedback') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method Not Allowed' }, 405, corsHeaders);
      }

      try {
        const body = await request.json();
        const message = typeof body.message === 'string' ? body.message.trim() : '';

        if (!message) return json({ ok: false, error: 'Введите текст отзыва.' }, 400, corsHeaders);
        if (!env.BOT_TOKEN) return json({ ok: false, error: 'BOT_TOKEN отсутствует в Secrets Cloudflare.' }, 500, corsHeaders);
        if (!env.CHAT_ID) return json({ ok: false, error: 'CHAT_ID отсутствует в Secrets Cloudflare.' }, 500, corsHeaders);

        let userName = 'Не определено';
        let userUsername = '';
        let telegramId = '';
        const initData = typeof body.initData === 'string' ? body.initData : '';

        if (initData) {
          const params = new URLSearchParams(initData);
          const userRaw = params.get('user');
          if (userRaw) {
            try {
              const user = JSON.parse(userRaw);
              telegramId = user.id ? String(user.id) : '';
              userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Не определено';
              userUsername = user.username ? `@${user.username}` : '';
            } catch (_) {}
          }
        }

        const lines = [
          '<b>📩 НОВЫЙ ОТЗЫВ</b>',
          '',
          `<b>👤 Имя:</b> ${escapeHtml(userName)}`
        ];

        if (userUsername) lines.push(`<b>📱 Telegram:</b> ${escapeHtml(userUsername)}`);
        if (body.phone) lines.push(`<b>📞 Телефон:</b> ${escapeHtml(String(body.phone))}`);
        if (telegramId) lines.push(`<b>🆔 Telegram ID:</b> ${escapeHtml(telegramId)}`);

        lines.push('', '<b>💬 Отзыв:</b>', `<b>${escapeHtml(message)}</b>`);

        const text = lines.join('\n');

        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: 'HTML' })
        });

        const telegramData = await telegramResponse.json();
        if (!telegramData.ok) {
          console.error('Telegram API error:', JSON.stringify(telegramData));
          return json({ ok: false, error: telegramData.description || 'Telegram не принял сообщение.' }, 502, corsHeaders);
        }

        return json({ ok: true }, 200, corsHeaders);
      } catch (error) {
        console.error('Feedback error:', error?.stack || error);
        return json({ ok: false, error: error?.message || 'Ошибка сервера.' }, 500, corsHeaders);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return assetResponse;

    const html = await assetResponse.text();
    const feedbackOverride = `<script data-feedback-handler="v5">
window.sendFeedback = async function(event) {
  if (event) event.preventDefault();

  const message = document.getElementById('fb-msg')?.value.trim() || '';
  const button = event?.submitter || document.querySelector('.feedback-form button[type="submit"]');
  const tg = window.Telegram?.WebApp;

  if (!message) {
    if (tg?.showAlert) tg.showAlert('Напишите отзыв или сообщение.');
    else alert('Напишите отзыв или сообщение.');
    return false;
  }

  const originalText = button ? button.innerHTML : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Отправка...';
  }

  try {
    const response = await fetch('/api/send-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        initData: tg?.initData || ''
      })
    });

    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Ошибка отправки');

    if (tg?.showAlert) tg.showAlert('Спасибо! Ваш отзыв отправлен.');
    else alert('Спасибо! Ваш отзыв отправлен.');

    document.getElementById('fb-msg').value = '';
  } catch (error) {
    console.error('Feedback error:', error);
    if (tg?.showAlert) tg.showAlert(error.message || 'Не удалось отправить отзыв.');
    else alert(error.message || 'Не удалось отправить отзыв.');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalText;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  return false;
};

(function setupContactRequest() {
  const tg = window.Telegram?.WebApp;
  const form = document.querySelector('.feedback-form');
  if (!form || !tg?.requestContact) return;

  const nameGroup = document.getElementById('fb-name')?.closest('.form-group');
  const phoneGroup = document.getElementById('fb-phone')?.closest('.form-group');
  if (nameGroup) nameGroup.remove();
  if (phoneGroup) phoneGroup.remove();

  const notice = document.createElement('div');
  notice.className = 'contact-card';
  notice.innerHTML = '<div style="font-size:13px;color:var(--text-gray);margin-bottom:12px">Чтобы мы могли связаться с вами по отзыву, поделитесь номером телефона один раз</div><button type="button" class="btn btn-outline" id="share-phone-btn">📱 Поделиться номером</button>';
  form.insertBefore(notice, form.firstChild);

  const button = document.getElementById('share-phone-btn');
  button.addEventListener('click', () => {
    tg.requestContact((shared) => {
      if (shared) {
        button.textContent = '✓ Номер передан Telegram';
        button.disabled = true;
      }
    });
  });
})();
</script>`;

    const updatedHtml = html.replace('</body>', feedbackOverride + '\n</body>');
    const headers = new Headers(assetResponse.headers);
    headers.delete('content-length');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    headers.set('X-Feedback-Handler', 'v5');

    return new Response(updatedHtml, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...extraHeaders
    }
  });
}
