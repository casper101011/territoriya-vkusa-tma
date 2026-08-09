export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS' && url.pathname === '/api/send-feedback') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/api/send-feedback') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method Not Allowed' }, 405, corsHeaders);
      }

      try {
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';

        if (!message) {
          return json({ ok: false, error: 'Введите текст отзыва.' }, 400, corsHeaders);
        }

        if (message.length > 4000) {
          return json({ ok: false, error: 'Отзыв слишком длинный.' }, 400, corsHeaders);
        }

        if (!env.BOT_TOKEN) {
          return json({ ok: false, error: 'Сервер ещё не настроен.' }, 500, corsHeaders);
        }

        let userName = 'Не определено';
        let userUsername = 'нет username';
        const initData = typeof body.initData === 'string' ? body.initData : '';

        if (initData) {
          const params = new URLSearchParams(initData);
          const userRaw = params.get('user');
          if (userRaw) {
            try {
              const user = JSON.parse(userRaw);
              userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Не определено';
              userUsername = user.username ? `@${user.username}` : 'нет username';
            } catch (_) {}
          }
        }

        const text = [
          '📩 НОВЫЙ ОТЗЫВ',
          '',
          `👤 Имя: ${name || 'Не указано'}`,
          `📞 Телефон: ${phone || 'Не указан'}`,
          `📱 Telegram: ${userName} (${userUsername})`,
          '',
          '💬 Отзыв:',
          message
        ].join('\n');

        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.CHAT_ID || '-1003258945693',
            text
          })
        });

        const telegramData = await telegramResponse.json();

        if (!telegramData.ok) {
          console.error('Telegram API error:', telegramData);
          return json({ ok: false, error: 'Telegram не принял сообщение. Проверьте бота и группу.' }, 502, corsHeaders);
        }

        return json({ ok: true }, 200, corsHeaders);
      } catch (error) {
        console.error('Feedback error:', error);
        return json({ ok: false, error: 'Не удалось отправить отзыв. Попробуйте ещё раз.' }, 500, corsHeaders);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = await assetResponse.text();
      const feedbackOverride = `<script>
async function sendFeedback(event) {
  event.preventDefault();
  const name = document.getElementById('fb-name')?.value.trim() || '';
  const phone = document.getElementById('fb-phone')?.value.trim() || '';
  const message = document.getElementById('fb-msg')?.value.trim() || '';
  const button = event.target?.querySelector('button[type="submit"]');
  const originalText = button ? button.innerHTML : '';
  if (!message) return;
  if (button) { button.disabled = true; button.textContent = 'Отправка...'; }
  try {
    const response = await fetch('/api/send-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, message, initData: window.Telegram?.WebApp?.initData || '' })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Ошибка отправки');
    alert('Спасибо! Ваш отзыв отправлен.');
    document.getElementById('fb-name').value = '';
    document.getElementById('fb-phone').value = '';
    document.getElementById('fb-msg').value = '';
  } catch (error) {
    console.error('Feedback error:', error);
    alert('Не удалось отправить отзыв. Попробуйте ещё раз.');
  } finally {
    if (button) { button.innerHTML = originalText; button.disabled = false; }
  }
}
</script>`;
      const updatedHtml = html.replace('</body>', feedbackOverride + '</body>');
      const headers = new Headers(assetResponse.headers);
      headers.delete('content-length');
      return new Response(updatedHtml, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    }

    return assetResponse;
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...extraHeaders
    }
  });
}
