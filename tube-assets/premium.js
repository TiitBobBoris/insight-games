/* Pesa premium-kujundus. Töötab ainult siis, kui <html> klass on "premium" (?v=premium).
 * Tõstab elemente ümber, aga ei muuda ega kustuta ühtegi data-tube-id elementi. */
(function () {
  var root = document.documentElement;
  if (!root.classList.contains('premium')) return;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  // Säilita ?v=premium ka siis, kui lingid viivad sama lehe teise ankrusse (vaikimisi säilib), ja menüüriba olek.
  var nav = $('.nav'), hero = $('.hero');
  function onScroll() { nav.classList.toggle('solid', hero.getBoundingClientRect().bottom < 60); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Avaekraani sissejuhatus faktide ribasse.
  var band = $('.facts-band'), body = $('[data-tube-id="hero-body"]');
  if (band && body) band.querySelector('.wrap').insertBefore(body, band.querySelector('.facts'));

  // Majad: üks korraga, lülitiga.
  var grid = $('.model-grid'), models = $$('.model', grid);
  if (grid && models.length) {
    var sw = document.createElement('div');
    sw.className = 'p-switch'; sw.setAttribute('role', 'tablist'); sw.setAttribute('aria-label', 'Vali maja');
    models.forEach(function (m, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab');
      var src = m.querySelector('img'), th = document.createElement('img');
      th.src = src ? src.getAttribute('src') : ''; th.alt = ''; th.loading = 'lazy'; th.decoding = 'async';
      var t = document.createElement('span'); t.textContent = m.dataset.model || ('PESA ' + (i + 1));
      b.appendChild(th); b.appendChild(t);
      b.addEventListener('click', function () { show(i); });
      sw.appendChild(b);
    });
    grid.parentNode.insertBefore(sw, grid);
    function show(i) {
      models.forEach(function (m, j) { m.classList.toggle('p-active', i === j); });
      $$('button', sw).forEach(function (b, j) { b.setAttribute('aria-selected', String(i === j)); });
      var d = $('#tubeDialog'); if (d && !d.hidden) { var c = $('#tubeClose'); if (c) c.click(); }
    }
    show(0);
  }

  // Päringuvorm kolmeks sammuks.
  var form = $('#offerForm');
  if (form) {
    var fields = $$(':scope > .two, :scope > .field', form);
    var contactStart = fields.filter(function (f) { return f.querySelector('#name'); })[0];
    var plotStart = fields.filter(function (f) { return f.querySelector('#plotChoices'); })[0];
    var names = ['Maja', 'Krunt ja soovid', 'Kontakt'];
    var steps = names.map(function () { var s = document.createElement('div'); s.className = 'p-step'; return s; });
    var first = fields[0], i = 0, stepIdx = 0;
    steps.forEach(function (s) { form.insertBefore(s, first); });
    // Vormi sisu alates esimesest väljast jagatakse sammudesse; pealkiri ja sissejuhatus jäävad üles.
    var kids = $$(':scope > *', form).filter(function (n) { return steps.indexOf(n) < 0 && n.tagName !== 'H3' && n.dataset.tubeId !== 'extra-text-48'; });
    kids.forEach(function (n) {
      if (n === plotStart) stepIdx = 1;
      if (n === contactStart) stepIdx = 2;
      steps[stepIdx].appendChild(n);
    });
    var prog = document.createElement('div'); prog.className = 'p-progress';
    names.forEach(function () { prog.appendChild(document.createElement('span')); });
    var label = document.createElement('p'); label.className = 'p-steplabel';
    form.insertBefore(prog, steps[0]); form.insertBefore(label, steps[0]);
    var navBox = document.createElement('div'); navBox.className = 'p-nav';
    var back = document.createElement('button'); back.type = 'button'; back.className = 'p-back'; back.textContent = '← Tagasi';
    var next = document.createElement('button'); next.type = 'button'; next.className = 'btn'; next.textContent = 'Edasi';
    navBox.appendChild(back); navBox.appendChild(next);
    form.appendChild(navBox);
    function go(n) {
      i = n;
      steps.forEach(function (s, j) { s.classList.toggle('p-current', j === i); });
      $$('span', prog).forEach(function (s, j) { s.classList.toggle('on', j <= i); });
      label.textContent = 'Samm ' + (i + 1) + '/3 · ' + names[i];
      back.hidden = i === 0;
      next.hidden = i === 2;
    }
    function valid() {
      return $$('input,select,textarea', steps[i]).every(function (el) { return el.checkValidity() || (el.reportValidity(), false); });
    }
    next.addEventListener('click', function () { if (valid()) { go(i + 1); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
    back.addEventListener('click', function () { go(i - 1); });
    go(0);
  }

  // Ilmumine kerimisel.
  var targets = $$('.section-head, .models h2, .models-lead, .p-switch, .model-grid, .proof .shot, .all-built-toggle, .story-top, .video, .spectrum > div, .compare, .step, .faq-list, .offer-intro, .form-card, .final .wrap > *, .facts > div, .facts-band p');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0 });
    targets.forEach(function (t, k) {
      t.classList.add('rv');
      if (t.matches('.shot, .step, .spectrum > div, .facts > div')) t.style.transitionDelay = ((k % 4) * 80) + 'ms';
      io.observe(t);
    });
    // Kindlustus: kui vaatleja hilineb, näita kõik vaateväljas olev ka kerimise peale.
    var pending = false;
    function sweep() { pending = false; targets.forEach(function (t) { if (!t.classList.contains('in') && t.getBoundingClientRect().top < innerHeight * .95) t.classList.add('in'); }); }
    window.addEventListener('scroll', function () { if (!pending) { pending = true; setTimeout(sweep, 120); } }, { passive: true });
    setTimeout(sweep, 600);
    window.addEventListener('load', function () { onScroll(); setTimeout(sweep, 300); });
    window.addEventListener('hashchange', function () { setTimeout(function () { onScroll(); sweep(); }, 700); });
  }

  // Fotod ilmuvad pehmelt, kui on laetud.
  $$('.shot img, .built-grid img, .model > img').forEach(function (img) {
    function done() { img.classList.add('p-loaded'); }
    img.classList.add('p-img');
    if (img.complete && img.naturalWidth) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); setTimeout(done, 4000); }
  });
})();

/* Avapildi ruumiline liikumine: foto + sügavuskaart (WebGL). Kaamera liigub aeglaselt külgsuunas,
 * lähemad objektid nihkuvad rohkem kui kaugemad. Töötab ainult foto jaoks, millel on sügavuskaart. */
function pesaParallax() {
  var DEPTH = { 'n-mme-005.webp': './tube-assets/hero-depth.jpg' };
  var img = document.querySelector('.hero-media');
  if (!img) return;
  var file = (img.getAttribute('src') || '').split('/').pop(), depthSrc = DEPTH[file];
  if (!depthSrc) return;
  var canvas = document.createElement('canvas');
  canvas.className = 'hero-media hero-depth'; canvas.setAttribute('aria-hidden', 'true');
  var gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) return;

  var vs = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;v.y=1.-v.y;gl_Position=vec4(p,0.,1.);}';
  var fs = [
    'precision mediump float;varying vec2 v;uniform sampler2D img,dep;uniform vec2 scale,off;uniform float focus;',
    'void main(){',
    '  vec2 uv=(v-.5)*scale+.5;',
    '  float d=texture2D(dep,uv).r;',
    '  vec2 s=uv-off*(d-focus);',
    '  float d2=texture2D(dep,s).r;',          // toon paremaks: teine samm mööda sügavust
    '  s=uv-off*(mix(d,d2,.5)-focus);',
    '  gl_FragColor=texture2D(img,clamp(s,.001,.999));',
    '}'].join('\n');
  function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
  var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return;
  var pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = function (n) { return gl.getUniformLocation(pr, n); };

  function tex(unit, im) {
    var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function load(src) { return new Promise(function (res, rej) { var i = new Image(); i.decoding = 'async'; i.onload = function () { res(i); }; i.onerror = rej; i.src = src; }); }

  Promise.all([load(img.currentSrc || img.src), load(depthSrc)]).then(function (r) {
    var photo = r[0];
    tex(0, photo); tex(1, r[1]);
    gl.uniform1i(U('img'), 0); gl.uniform1i(U('dep'), 1);
    gl.uniform1f(U('focus'), .38); // maja tasapind püsib peaaegu paigal
    var ia = photo.naturalWidth / photo.naturalHeight, running = true, visible = true, t0 = performance.now();
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      var ca = w / h, zoom = 1.045; // kerge suurendus, et servad ei paistaks
      gl.uniform2f(U('scale'), (ca < ia ? ca / ia : 1) / zoom, (ca < ia ? 1 : ia / ca) / zoom);
    }
    function frame(now) {
      if (!running) return;
      var k = Math.sin((now - t0) / 16000 * Math.PI * 2 - Math.PI / 2); // 16 s edasi-tagasi, algab paigalt
      gl.uniform2f(U('off'), .028 * (k + 1) / 2, .004 * (k + 1) / 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(frame);
    }
    img.after(canvas); size();
    window.addEventListener('resize', size);
    requestAnimationFrame(function (n) { frame(n); canvas.classList.add('on'); });
    function toggle() {
      var go = visible && document.visibilityState === 'visible';
      if (go && !running) { running = true; requestAnimationFrame(frame); } else if (!go) running = false;
    }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; toggle(); }).observe(canvas);
    document.addEventListener('visibilitychange', toggle);
  }).catch(function () {});
}

/* Avavideo: kaamera liigub aeglaselt vasakule (Higgsfield, Nõmme foto põhjal). Kui video ei käivitu
 * (nt säästurežiim või aeglane ühendus), jääb foto ja selle sügavusliikumine. */
(function () {
  var root = document.documentElement;
  if (!root.classList.contains('premium') || /[?&]edit=1/.test(location.search)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var img = document.querySelector('.hero-media');
  if (!img || !/n-mme-005\.webp$/.test(img.getAttribute('src') || '')) return;
  var conn = navigator.connection || {};
  if (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')) { pesaParallax(); return; }
  var small = Math.max(screen.width, screen.height) * Math.min(window.devicePixelRatio || 1, 2) < 1600 || window.innerWidth < 900;
  var v = document.createElement('video');
  v.className = 'hero-media hero-video'; v.setAttribute('aria-hidden', 'true');
  v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.preload = 'auto';
  v.poster = './tube-assets/video/pesa-hero-poster.webp';
  v.src = './tube-assets/video/pesa-hero-' + (small ? '720' : '1080') + '.mp4';
  var done = false;
  function fail() { if (done) return; done = true; v.remove(); pesaParallax(); }
  v.addEventListener('playing', function () { if (done) return; done = true; v.classList.add('on'); }, { once: true });
  v.addEventListener('error', fail, { once: true });
  setTimeout(function () { if (!done && v.readyState < 3) fail(); }, 8000);
  img.after(v);
  var p = v.play(); if (p && p.catch) p.catch(fail);
  // Peata, kui avapilt pole nähtav.
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { if (!done || !v.isConnected) return; e[0].isIntersecting ? v.play().catch(function () {}) : v.pause(); }).observe(v);
})();
