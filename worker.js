export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

    if (url.pathname === '/api/send-feedback') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405, corsHeaders);

      try {
        const body = await request.json();
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message) return json({ ok: false, error: 'Введите текст отзыва.' }, 400, corsHeaders);
        if (!env.BOT_TOKEN) return json({ ok: false, error: 'BOT_TOKEN отсутствует в Secrets Cloudflare.' }, 500, corsHeaders);
        if (!env.CHAT_ID) return json({ ok: false, error: 'CHAT_ID отсутствует в Secrets Cloudflare.' }, 500, corsHeaders);

        let userName = 'Не определено';
        let userUsername = '';
        let telegramId = '';
        let firstName = '';
        let lastName = '';

        const initData = typeof body.initData === 'string' ? body.initData : '';
        if (initData) {
          const userRaw = new URLSearchParams(initData).get('user');
          if (userRaw) {
            try {
              const user = JSON.parse(userRaw);
              telegramId = user.id ? String(user.id) : '';
              firstName = user.first_name || '';
              lastName = user.last_name || '';
              userName = [firstName, lastName].filter(Boolean).join(' ') || 'Не определено';
              userUsername = user.username ? `@${user.username}` : '';
            } catch (_) {}
          }
        }

        const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : '';

        // D1 не должен блокировать отправку отзыва в Telegram.
        // Если таблицы ещё не применены или произошла ошибка базы, отзыв всё равно уйдёт.
        let dbError = '';
        if (env.DB) {
          try {
            if (telegramId) {
              await env.DB.prepare(`INSERT INTO users (telegram_id, username, first_name, last_name, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, last_name=excluded.last_name, updated_at=datetime('now')`).bind(telegramId, userUsername ? userUsername.slice(1) : null, firstName || null, lastName || null).run();
              await env.DB.prepare(`UPDATE users SET phone=?, updated_at=datetime('now') WHERE telegram_id=?`).bind(phone || null, telegramId).run();
            }
            await env.DB.prepare(`INSERT INTO feedback (telegram_id, username, name, phone, message, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).bind(telegramId || null, userUsername ? userUsername.slice(1) : null, userName, phone || null, message).run();
          } catch (error) {
            dbError = error?.message || 'Ошибка D1';
            console.error('D1 error:', error?.stack || error);
          }
        } else {
          dbError = 'DB binding отсутствует';
          console.error(dbError);
        }

        const lines = ['<b>📩 НОВЫЙ ОТЗЫВ</b>', '', `<b>👤 Имя:</b> ${escapeHtml(userName)}`];
        if (userUsername) lines.push(`<b>📱 Telegram:</b> ${escapeHtml(userUsername)}`);
        if (phone) lines.push(`<b>📞 Телефон:</b> ${escapeHtml(phone)}`);
        if (telegramId) lines.push(`<b>🆔 Telegram ID:</b> ${escapeHtml(telegramId)}`);
        lines.push('', '<b>💬 Отзыв:</b>', `<b>${escapeHtml(message)}</b>`);

        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.CHAT_ID, text: lines.join('\n'), parse_mode: 'HTML' })
        });

        const telegramData = await telegramResponse.json();
        if (!telegramData.ok) return json({ ok: false, error: telegramData.description || 'Telegram не принял сообщение.' }, 502, corsHeaders);

        console.log('Feedback sent', { telegramId, userUsername, dbError: dbError || null });
        return json({ ok: true, dbSaved: !dbError }, 200, corsHeaders);
      } catch (error) {
        console.error('Feedback error:', error?.stack || error);
        return json({ ok: false, error: error?.message || 'Ошибка сервера.' }, 500, corsHeaders);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return assetResponse;
    const html = await assetResponse.text();
    const feedbackOverride = `<script data-feedback-handler="v7">
window.sendFeedback = async function(event) {
  if (event) event.preventDefault();
  const message = document.getElementById('fb-msg')?.value.trim() || '', button = event?.submitter || document.querySelector('.feedback-form button[type="submit"]'), tg = window.Telegram?.WebApp;
  if (!message) { if (tg?.showAlert) tg.showAlert('Напишите отзыв или сообщение.'); else alert('Напишите отзыв или сообщение.'); return false; }
  const originalText = button ? button.innerHTML : ''; if (button) { button.disabled = true; button.textContent = 'Отправка...'; }
  try {
    const response = await fetch('/api/send-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, initData: tg?.initData || '' }) });
    const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || 'Ошибка отправки');
    if (tg?.showAlert) tg.showAlert('Спасибо! Ваш отзыв отправлен.'); else alert('Спасибо! Ваш отзыв отправлен.'); document.getElementById('fb-msg').value = '';
  } catch (error) { console.error('Feedback error:', error); if (tg?.showAlert) tg.showAlert(error.message || 'Не удалось отправить отзыв.'); else alert(error.message || 'Не удалось отправить отзыв.'); }
  finally { if (button) { button.disabled = false; button.innerHTML = originalText; if (window.lucide) window.lucide.createIcons(); } } return false;
};
(function setupContactRequest() {
  const tg = window.Telegram?.WebApp, form = document.querySelector('.feedback-form'); if (!form || !tg?.requestContact) return;
  const nameGroup = document.getElementById('fb-name')?.closest('.form-group'), phoneGroup = document.getElementById('fb-phone')?.closest('.form-group'); if (nameGroup) nameGroup.remove(); if (phoneGroup) phoneGroup.remove();
  const notice = document.createElement('div'); notice.className = 'contact-card'; notice.innerHTML = '<div style="font-size:13px;color:var(--text-gray);margin-bottom:12px">Чтобы мы могли связаться с вами по отзыву, поделитесь номером телефона один раз</div><button type="button" class="btn btn-outline" id="share-phone-btn">📱 Поделиться номером</button>'; form.insertBefore(notice, form.firstChild);
  document.getElementById('share-phone-btn').addEventListener('click', () => tg.requestContact(shared => { if (shared) { const b = document.getElementById('share-phone-btn'); b.textContent = '✓ Номер передан Telegram'; b.disabled = true; } }));
})();
</script>`;
    const updatedHtml = html.replace('</body>', feedbackOverride + '\n</body>');
    const headers = new Headers(assetResponse.headers); headers.delete('content-length'); headers.set('Cache-Control', 'no-store, no-cache, must-revalidate'); headers.set('X-Feedback-Handler', 'v7');
    return new Response(updatedHtml, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
  }
};
function escapeHtml(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function json(data, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=UTF-8', ...extraHeaders } }); }
