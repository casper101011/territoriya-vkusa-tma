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
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';

        if (!message) {
          return json({ ok: false, error: 'Введите текст отзыва.' }, 400, corsHeaders);
        }

        if (!env.BOT_TOKEN) {
          return json({ ok: false, error: 'Сервер ещё не настроен: BOT_TOKEN отсутствует.' }, 500, corsHeaders);
        }

        if (!env.CHAT_ID) {
          return json({ ok: false, error: 'Сервер ещё не настроен: CHAT_ID отсутствует.' }, 500, corsHeaders);
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
          body: JSON.stringify({ chat_id: env.CHAT_ID, text })
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

    const feedbackOverride = `
<script>
(function () {
  function showMessage(message) {
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.showAlert === 'function') {
      window.Telegram.WebApp.showAlert(message);
    } else {
      alert(message);
    }
  }

  async function submitFeedback(form, event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const nameEl = document.getElementById('fb-name');
    const phoneEl = document.getElementById('fb-phone');
    const messageEl = document.getElementById('fb-msg');
    const button = form.querySelector('button[type="submit"]');
    const message = messageEl ? messageEl.value.trim() : '';

    if (!message) {
      showMessage('Напишите отзыв или сообщение.');
      return;
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
          name: nameEl ? nameEl.value.trim() : '',
          phone: phoneEl ? phoneEl.value.trim() : '',
          message,
          initData: window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initData || '' : ''
        })
      });

      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Ошибка отправки');

      showMessage('Спасибо! Ваш отзыв отправлен.');
      if (nameEl) nameEl.value = '';
      if (phoneEl) phoneEl.value = '';
      if (messageEl) messageEl.value = '';
    } catch (error) {
      console.error('Feedback error:', error);
      showMessage(error.message || 'Не удалось отправить отзыв.');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  document.addEventListener('submit', function (event) {
    const form = event.target;
    if (form && form.classList && form.classList.contains('feedback-form')) {
      submitFeedback(form, event);
    }
  }, true);
})();
</script>`;

    const updatedHtml = html.includes('</body>')
      ? html.replace('</body>', feedbackOverride + '\n</body>')
      : html + feedbackOverride;

    const headers = new Headers(assetResponse.headers);
    headers.delete('content-length');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    return new Response(updatedHtml, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
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
