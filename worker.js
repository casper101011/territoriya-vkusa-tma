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
          return json({ ok: false, error: 'Сервер ещё не настроен.' }, 500, corsHeaders);
        }

        if (!env.CHAT_ID) {
          return json({ ok: false, error: 'CHAT_ID не настроен.' }, 500, corsHeaders);
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
            chat_id: env.CHAT_ID,
            text
          })
        });

        const telegramData = await telegramResponse.json();

        if (!telegramData.ok) {
          return json({
            ok: false,
            error: telegramData.description || 'Telegram не принял сообщение.'
          }, 502, corsHeaders);
        }

        return json({ ok: true }, 200, corsHeaders);
      } catch (error) {
        console.error('Feedback error:', error?.stack || error);
        return json({ ok: false, error: 'Не удалось отправить отзыв. Попробуйте ещё раз.' }, 500, corsHeaders);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return assetResponse;
    }

    const html = await assetResponse.text();

    const oldFunction = `function sendFeedback(event) {
            event.preventDefault();
            const name = document.getElementById('fb-name').value;
            const phone = document.getElementById('fb-phone').value;
            const message = document.getElementById('fb-msg').value;

            const payload = {
                type: 'feedback',
                name: name || 'Не указано',
                phone: phone || 'Не указан',
                message: message,
                date: new Date().toLocaleDateString('ru-RU')
            };

            if (tg && tg.sendData) {
                tg.sendData(JSON.stringify(payload));
            } else {
                alert('Спасибо за отзыв! Сообщение отправлено.');
            }
        }`;

    const newFunction = `async function sendFeedback(event) {
            event.preventDefault();

            const nameEl = document.getElementById('fb-name');
            const phoneEl = document.getElementById('fb-phone');
            const messageEl = document.getElementById('fb-msg');
            const button = event.submitter || document.querySelector('.feedback-form button[type="submit"]');

            const name = nameEl ? nameEl.value.trim() : '';
            const phone = phoneEl ? phoneEl.value.trim() : '';
            const message = messageEl ? messageEl.value.trim() : '';

            if (!message) {
                if (tg && tg.showAlert) tg.showAlert('Напишите отзыв или сообщение.');
                else alert('Напишите отзыв или сообщение.');
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
                        name,
                        phone,
                        message,
                        initData: tg ? (tg.initData || '') : ''
                    })
                });

                const result = await response.json();

                if (!response.ok || !result.ok) {
                    throw new Error(result.error || 'Ошибка отправки');
                }

                if (tg && tg.showAlert) tg.showAlert('Спасибо! Ваш отзыв отправлен.');
                else alert('Спасибо! Ваш отзыв отправлен.');

                if (nameEl) nameEl.value = '';
                if (phoneEl) phoneEl.value = '';
                if (messageEl) messageEl.value = '';
            } catch (error) {
                console.error('Feedback error:', error);
                if (tg && tg.showAlert) tg.showAlert(error.message || 'Не удалось отправить отзыв. Попробуйте ещё раз.');
                else alert(error.message || 'Не удалось отправить отзыв. Попробуйте ещё раз.');
            } finally {
                if (button) {
                    button.innerHTML = originalText;
                    button.disabled = false;
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        }`;

    const updatedHtml = html.includes(oldFunction)
      ? html.replace(oldFunction, newFunction)
      : html;

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
