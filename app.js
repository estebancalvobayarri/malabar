(function () {
  var cfg = window.NPROJECTS_CONFIG || {};
  var live = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var OK_TEXT = '¡Estás dentro! Te avisaremos en cuanto abramos la beta.';

  function show(form, text, kind) {
    var msg = form.querySelector('.msg');
    msg.textContent = text;
    msg.className = 'msg ' + kind;
  }

  function save(email, source) {
    if (!live) return Promise.resolve();
    var headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Prefer: 'return=minimal' };
    // Las claves antiguas (JWT) van también como Bearer; las nuevas sb_publishable_ solo como apikey
    if (cfg.supabaseAnonKey.indexOf('sb_') !== 0) headers.Authorization = 'Bearer ' + cfg.supabaseAnonKey;
    var url = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + (cfg.table || 'waitlist');
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        email: email,
        source: source,
        lang: navigator.language || null,
        referrer: document.referrer || null
      })
    }).then(function (res) {
      // 409 = el email ya estaba apuntado: para el usuario es un éxito
      if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status);
    });
  }

  document.querySelectorAll('form.waitlist').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (form.website && form.website.value) return; // trampa para bots
      var input = form.querySelector('input[type=email]');
      var email = (input.value || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        show(form, 'Revisa el email: parece que falta algo.', 'err');
        input.focus();
        return;
      }
      var btn = form.querySelector('button');
      btn.disabled = true;
      save(email, form.dataset.source || 'web')
        .then(function () {
          form.classList.add('done');
          show(form, OK_TEXT, 'ok');
          document.querySelectorAll('form.waitlist').forEach(function (f) {
            if (f !== form) { f.classList.add('done'); show(f, OK_TEXT, 'ok'); }
          });
        })
        .catch(function () {
          show(form, 'No hemos podido guardarlo. Inténtalo de nuevo en un momento.', 'err');
        })
        .then(function () { btn.disabled = false; });
    });
  });
})();
