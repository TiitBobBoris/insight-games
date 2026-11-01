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
