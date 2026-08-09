export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/send-feedback') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method Not Allowed' }, 405);
      }

      try {
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';

        if (!message) {
          return json({ ok: false, error: 'Введите текст отзыва.' }, 400);
        }

        if (message.length > 4000) {
          return json({ ok: false, error: 'Отзыв слишком длинный.' }, 400);
        }

        if (!env.BOT_TOKEN) {
          return json({ ok: false, error: 'Сервер ещё не настроен.' }, 500);
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
          return json({ ok: false, error: 'Telegram не принял сообщение. Проверьте бота и группу.' }, 502);
        }

        return json({ ok: true });
      } catch (error) {
        console.error('Feedback error:', error);
        return json({ ok: false, error: 'Не удалось отправить отзыв. Попробуйте ещё раз.' }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' }
  });
}
