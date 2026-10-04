(() => {
  const root = document.documentElement;
  // The OS Reduce Motion setting is deliberately not honored: every visitor gets the full motion.
  // To honor it again, set this back to matchMedia('(prefers-reduced-motion: reduce)').matches.
  const reduce = false;
  if (reduce) root.classList.add('reduced-motion');

  const debounce = (fn, ms) => {
    let id;
    return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
  };

  /* Smooth inertia scrolling */
  let lenis = null;
  if (!reduce && typeof window.Lenis === 'function') {
    lenis = new window.Lenis({ lerp: 0.09, anchors: { offset: -96 } });
    window.veridienLenis = lenis; // the Home hero steps through its captions with it
    // Lenis turns smoothing off under the OS Reduce Motion setting; the site doesn't honor it (see `reduce`)
    if (!reduce) Object.defineProperty(lenis, 'prefersReducedMotion', { get: () => false });
    const loop = (t) => { lenis.raf(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /* Split text into masked words; words sharing a line share a reveal delay */
  const splitTargets = [...document.querySelectorAll('[data-reveal="lines"]')];

  const splitWords = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(' '));
          return;
        }
        const mask = document.createElement('span');
        mask.className = 'w';
        const inner = document.createElement('span');
        inner.className = 'wi';
        inner.textContent = part;
        mask.appendChild(inner);
        frag.appendChild(mask);
      });
      node.replaceWith(frag);
    });
  };

  const assignLines = (el) => {
    let line = -1;
    let lastTop = null;
    el.querySelectorAll('.w').forEach((w) => {
      const top = w.offsetTop;
      if (lastTop === null || Math.abs(top - lastTop) > 4) {
        line += 1;
        lastTop = top;
      }
      w.style.setProperty('--line', line);
    });
  };

  splitTargets.forEach(splitWords);
  const assignAll = () => splitTargets.forEach(assignLines);
  assignAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(assignAll);
  addEventListener('resize', debounce(assignAll, 150));

  /* Reveal on scroll; hero content waits for the intro to finish */
  // Elements marked data-manual (hero captions) are toggled by abdomen.js, not revealed on scroll
  const revealEls = [...document.querySelectorAll('[data-reveal]:not([data-manual])')];
  let io = null;
  if (!('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-in'));
  } else {
    io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });
    revealEls.forEach((el) => { if (!el.closest('[data-hold]')) io.observe(el); });
  }
  const releaseHeld = () => {
    document.querySelectorAll('[data-hold] [data-reveal]:not([data-manual])').forEach((el) => el.classList.add('is-in'));
  };

  /* Hero word cycler: split words slide in from different directions and loop,
     resting longer on the final word, which completes the headline */
  const runCycler = () => {
    const title = document.querySelector('.hero-title');
    if (!title) return;
    const slot = title.querySelector('.cycler-slot');
    const words = slot ? [...slot.querySelectorAll('.cw')] : [];
    title.classList.add('is-in');
    if (!words.length) return;

    const last = words.length - 1;
    let current = 0;
    const fit = () => { slot.style.width = `${words[current].getBoundingClientRect().width}px`; };
    fit();
    addEventListener('resize', debounce(fit, 100));
    words[0].classList.add('is-in');

    const advance = () => {
      if (document.hidden) { setTimeout(advance, 500); return; }
      const prev = words[current];
      prev.classList.remove('is-in');
      prev.classList.add('is-out');
      current = (current + 1) % words.length;
      const next = words[current];
      // A word that already exited sits above its mask; snap it back to its entry position unseen
      next.classList.add('no-anim');
      next.classList.remove('is-out');
      void next.offsetWidth;
      next.classList.remove('no-anim');
      next.classList.add('is-in');
      fit();
      setTimeout(advance, current === last ? 3600 : 1500);
    };
    setTimeout(advance, 1900);
  };

  /* Start sequence (after the intro screen, if it plays) */
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    document.body.classList.add('is-ready');
    window.veridienStartedAt = performance.now();
    window.dispatchEvent(new Event('veridien:start'));
    releaseHeld();
    runCycler();
  };

  const preloader = document.querySelector('.preloader');
  const playIntro = preloader && !root.classList.contains('no-intro');
  if (playIntro) {
    try { sessionStorage.setItem('veridien-intro', '1'); } catch (e) { /* storage unavailable */ }
    if (lenis) lenis.stop();
    requestAnimationFrame(() => preloader.classList.add('is-active'));
    setTimeout(() => preloader.classList.add('is-leaving'), 1500);
    setTimeout(() => { if (lenis) lenis.start(); start(); }, 1850);
    setTimeout(() => preloader.remove(), 2700);
  } else {
    if (preloader) preloader.remove();
    requestAnimationFrame(start);
  }

  /* Scroll-linked hero parallax */
  const hero = document.querySelector('.hero');
  if (hero && !reduce) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const p = Math.min(Math.max(scrollY / Math.max(hero.offsetHeight, 1), 0), 1);
      hero.style.setProperty('--hero-p', p.toFixed(4));
    };
    addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* Fixed nav: tinted once scrolled, hides while scrolling down, returns on scroll up */
  const nav = document.querySelector('.site-nav');
  if (nav) {
    let lastY = scrollY;
    let navTicking = false;
    const updateNav = () => {
      navTicking = false;
      const y = scrollY;
      nav.classList.toggle('is-scrolled', y > 24);
      if (!root.classList.contains('menu-open')) {
        nav.classList.toggle('is-hidden', y > lastY && y > 160);
      }
      lastY = y;
    };
    addEventListener('scroll', () => {
      if (!navTicking) { navTicking = true; requestAnimationFrame(updateNav); }
    }, { passive: true });
    updateNav();
  }

  /* Mobile menu: full-screen sheet; focus stays inside while open; Esc closes */
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('site-menu');
  if (toggle && menu) {
    const label = toggle.querySelector('.menu-label');
    const focusables = () => [toggle, ...menu.querySelectorAll('a')];
    const setMenu = (open) => {
      root.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Close' : 'Menu';
      menu.inert = !open;
      if (open) {
        if (lenis) lenis.stop();
        const first = menu.querySelector('a');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
      } else {
        if (lenis) lenis.start();
      }
    };
    menu.inert = true;
    toggle.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', (e) => {
      if (!root.classList.contains('menu-open')) return;
      if (e.key === 'Escape') {
        setMenu(false);
        toggle.focus();
      } else if (e.key === 'Tab') {
        const items = focusables();
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    });
    addEventListener('resize', debounce(() => {
      if (innerWidth >= 960 && root.classList.contains('menu-open')) setMenu(false);
    }, 150));
  }

  /* Research: project thumbnails open into a panel that grows out of the thumbnail.
     The detail article moves into the dialog while open and back afterwards;
     the URL hash (#myomectomy, ...) opens a project directly. */
  const dialog = document.querySelector('.work-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    const panel = dialog.querySelector('.work-panel');
    const body = dialog.querySelector('.work-body');
    const shelf = document.querySelector('.work-details');
    const cards = [...document.querySelectorAll('.work-card')];
    let card = null;
    let detail = null;
    let closing = false;

    // Transform that makes the panel sit exactly over the card's thumbnail
    const fromThumb = () => {
      const a = card.querySelector('.work-thumb').getBoundingClientRect();
      const b = panel.getBoundingClientRect();
      return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    };
    const timing = (ms) => ({ duration: ms, easing: 'cubic-bezier(0.52, 0.01, 0, 1)' });
    const setHash = (slug) => {
      try { history.replaceState(null, '', slug ? `#${slug}` : location.pathname + location.search); } catch (e) { /* file:// */ }
    };

    const open = (btn, instant) => {
      if (detail) return;
      card = btn;
      detail = document.getElementById(btn.getAttribute('aria-controls'));
      if (!detail) return;
      // Line-art projects reuse the thumbnail's drawing at full size
      const art = detail.querySelector('[data-art]');
      if (art && !art.firstElementChild) {
        const svg = btn.querySelector('svg').cloneNode(true);
        svg.classList.remove('is-in');
        art.appendChild(svg);
      }
      body.appendChild(detail);
      body.scrollTop = 0;
      dialog.setAttribute('aria-labelledby', detail.getAttribute('aria-labelledby'));
      dialog.showModal();
      if (lenis) lenis.stop();
      root.classList.add('work-open');
      setHash(btn.dataset.work);
      if (!instant) panel.animate([{ transform: fromThumb() }, { transform: 'none' }], timing(700));
      requestAnimationFrame(() => {
        dialog.classList.add('is-open');
        if (art) setTimeout(() => art.firstElementChild.classList.add('is-in'), 350);
      });
    };

    const close = () => {
      if (!detail || closing) return;
      closing = true;
      dialog.classList.remove('is-open');
      const finish = () => {
        dialog.close();
        const art = detail.querySelector('[data-art] svg');
        if (art) art.classList.remove('is-in');
        shelf.appendChild(detail);
        detail = null;
        closing = false;
        root.classList.remove('work-open');
        if (lenis) lenis.start();
        setHash('');
        card.focus({ preventScroll: true });
      };
      const shrink = panel.animate([{ transform: 'none' }, { transform: fromThumb() }], { ...timing(520), delay: 140, fill: 'forwards' });
      // The timeout covers browsers that skip the finish event (e.g. the tab is hidden mid-close)
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        finish();
        shrink.cancel();
      };
      shrink.onfinish = end;
      setTimeout(end, 760);
    };

    cards.forEach((btn) => btn.addEventListener('click', () => open(btn)));
    dialog.querySelector('.work-close').addEventListener('click', close);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

    const fromHash = () => {
      const slug = location.hash.slice(1);
      const btn = slug && cards.find((c) => c.dataset.work === slug);
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        open(btn, true);
      }
    };
    fromHash();
    addEventListener('hashchange', () => { if (!detail) fromHash(); });
  }

  /* Forms: submit to Formspree once the form's action points there; until then,
     open a pre-filled email to contact@veridienlabs.org */
  document.querySelectorAll('form[data-form]').forEach((form) => {
    const status = form.querySelector('.form-status');
    const success = document.getElementById(form.dataset.success);
    const button = form.querySelector('button[type="submit"]');

    const setError = (field, message) => {
      field.setAttribute('aria-invalid', message ? 'true' : 'false');
      const err = document.getElementById(field.getAttribute('aria-describedby'));
      if (err) err.textContent = message;
    };
    const validate = () => {
      let firstInvalid = null;
      form.querySelectorAll('[required]').forEach((field) => {
        const value = field.value.trim();
        let message = '';
        if (!value) message = field.dataset.error || 'This field is required.';
        else if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = 'Enter an email address like name@example.com.';
        setError(field, message);
        if (message && !firstInvalid) firstInvalid = field;
      });
      if (firstInvalid) firstInvalid.focus();
      return !firstInvalid;
    };
    form.addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid') === 'true') setError(e.target, '');
    });

    const summarize = (data) => {
      const lines = [];
      const seen = new Set();
      data.forEach((_, key) => {
        if (key.startsWith('_') || seen.has(key)) return;
        seen.add(key);
        const value = data.getAll(key).map((v) => String(v).trim()).filter(Boolean).join(', ');
        if (value) lines.push(`${key.charAt(0).toUpperCase()}${key.slice(1)}: ${value}`);
      });
      return lines.join('\n');
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) return;
      const data = new FormData(form);
      if (data.get('_gotcha')) return;

      if (!/formspree\.io\/f\/\w+/.test(form.getAttribute('action') || '')) {
        const subject = encodeURIComponent(data.get('_subject') || 'Veridien website');
        const body = encodeURIComponent(summarize(data));
        window.location.href = `mailto:contact@veridienlabs.org?subject=${subject}&body=${body}`;
        if (status) status.textContent = 'Your email app should open with this message filled in. Send it from there.';
        return;
      }

      form.classList.add('is-sending');
      if (button) button.disabled = true;
      if (status) status.textContent = 'Sending…';
      try {
        const res = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Formspree responded ${res.status}`);
        form.hidden = true;
        if (success) {
          success.hidden = false;
          success.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
          const heading = success.querySelector('[tabindex="-1"]');
          if (heading) heading.focus();
        }
      } catch (err) {
        if (status) status.textContent = "That didn't send. Try again, or email contact@veridienlabs.org directly.";
      } finally {
        form.classList.remove('is-sending');
        if (button) button.disabled = false;
      }
    });
  });
})();
