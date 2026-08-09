const FEEDBACK_FUNCTION = `
        async function sendFeedback(e) {
            e.preventDefault();
            const textarea = document.getElementById('fb-msg');
            const messageText = textarea.value.trim();
            if (!messageText) return;

            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Отправка...';
            submitBtn.disabled = true;

            try {
                const response = await fetch('/api/send-feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: messageText,
                        initData: tg.initData || ''
                    })
                });

                const data = await response.json();

                if (data.ok) {
                    textarea.value = '';
                    alert('Спасибо! Ваш отзыв успешно отправлен.');
                    switchTab('home', document.querySelector('.nav-item:nth-child(1)'));
                } else {
                    alert(data.error || 'Не удалось отправить отзыв.');
                }
            } catch (error) {
                console.error('Network error:', error);
                alert('Не удалось отправить отзыв. Попробуйте ещё раз.');
            } finally {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }
`;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/api/send-feedback') {
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', { status: 405 });
            }

            try {
                const body = await request.json();
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

                let userName = 'Аноним';
                let userUsername = 'нет username';
                const initData = typeof body.initData === 'string' ? body.initData : '';

                if (initData) {
                    const params = new URLSearchParams(initData);
                    const userRaw = params.get('user');
                    if (userRaw) {
                        try {
                            const user = JSON.parse(userRaw);
                            userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Аноним';
                            userUsername = user.username ? `@${user.username}` : 'нет username';
                        } catch (_) {}
                    }
                }

                const text = `📩 Новый отзыв:\n\n${message}\n\nОт: ${userName} (${userUsername})`;

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
                    return json({ ok: false, error: 'Telegram не принял сообщение. Проверьте настройки бота и группы.' }, 502);
                }

                return json({ ok: true });
            } catch (error) {
                console.error('Feedback error:', error);
                return json({ ok: false, error: 'Не удалось отправить отзыв. Попробуйте ещё раз.' }, 500);
            }
        }

        const response = await env.ASSETS.fetch(request);
        const contentType = response.headers.get('content-type') || '';

        if (!contentType.includes('text/html')) {
            return response;
        }

        let html = await response.text();
        html = html.replace(/\s*const BOT_TOKEN = '[^']*';\s*const CHAT_ID = '[^']*';\s*/s, '\n');
        html = html.replace(/        async function sendFeedback\(e\) \{[\s\S]*?\n        \}\n    <\\/script>/, `${FEEDBACK_FUNCTION}    </script>`);

        return new Response(html, {
            status: response.status,
            headers: response.headers
        });
    }
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' }
    });
}
