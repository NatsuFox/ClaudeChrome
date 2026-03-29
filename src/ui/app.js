const root = document.documentElement;
const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
const scrollProgress = document.querySelector('[data-scroll-progress]');

root.classList.add('js');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (_) {
    // Ignore unsupported fallback failures.
  }
  document.body.removeChild(textarea);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      fallbackCopy(text);
      return true;
    }
  }

  fallbackCopy(text);
  return true;
}

function flashCopied(button) {
  const label = button.querySelector('[data-copy-label]');
  const previous = label ? label.textContent : null;
  button.classList.add('is-copied');
  if (label) {
    label.textContent = 'Copied';
  }
  window.setTimeout(() => {
    button.classList.remove('is-copied');
    if (label && previous) {
      label.textContent = previous;
    }
  }, 900);
}

function initNav() {
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const isOpen = root.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        root.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const sections = Array.from(document.querySelectorAll('[data-section]'));
  const links = Array.from(document.querySelectorAll('[data-nav-link]'));

  if (!sections.length || !links.length) {
    return;
  }

  const linkMap = new Map(
    links.map((link) => {
      const hash = link.getAttribute('href');
      return [hash, link];
    })
  );

  const activateLink = (id) => {
    links.forEach((link) => {
      link.setAttribute('aria-current', String(link.getAttribute('href') === `#${id}`));
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) {
        return;
      }

      const id = visible.target.id;
      if (id && linkMap.has(`#${id}`)) {
        activateLink(id);
      }
    },
    {
      threshold: [0.24, 0.45, 0.66],
      rootMargin: '-15% 0px -45% 0px',
    }
  );

  sections.forEach((section) => observer.observe(section));
}

function initScrollProgress() {
  if (!scrollProgress) {
    return;
  }

  const update = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? window.scrollY / max : 0;
    scrollProgress.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
}

function initReveal() {
  const items = document.querySelectorAll('.section-animate');
  if (!items.length || prefersReducedMotion) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.18,
      rootMargin: '0px 0px -8% 0px',
    }
  );

  items.forEach((item) => observer.observe(item));
}

function initCommandTerminal() {
  const terminal = document.querySelector('[data-command-terminal]');
  if (!terminal) {
    return;
  }

  const tabs = Array.from(terminal.querySelectorAll('[data-command-tab]'));
  const panels = Array.from(terminal.querySelectorAll('[data-command-panel]'));
  const copyButton = terminal.querySelector('[data-command-copy]');

  const setActive = (key) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.commandTab === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    panels.forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.commandPanel === key);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setActive(tab.dataset.commandTab);
    });
  });

  copyButton?.addEventListener('click', async () => {
    const active = terminal.querySelector('.command-panel.is-active');
    if (!active) {
      return;
    }

    const text = active.dataset.clipboard || active.textContent.trim();
    await copyText(text);
    flashCopied(copyButton);
  });
}

function initCopyButtons() {
  document.querySelectorAll('[data-copy-text]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.dataset.copyText;
      if (!text) {
        return;
      }
      await copyText(text);
      flashCopied(button);
    });
  });
}

function initStageTilt() {
  const scene = document.querySelector('[data-stage-scene]');
  if (!scene || prefersReducedMotion) {
    return;
  }

  const frame = scene.querySelector('.browser-frame');
  if (!frame) {
    return;
  }

  const reset = () => {
    frame.style.setProperty('--stage-tilt-x', '0deg');
    frame.style.setProperty('--stage-tilt-y', '0deg');
    frame.style.setProperty('--stage-shift-x', '0px');
    frame.style.setProperty('--stage-shift-y', '0px');
  };

  scene.addEventListener('pointermove', (event) => {
    const rect = scene.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;

    frame.style.setProperty('--stage-tilt-x', `${(-py * 4.5).toFixed(2)}deg`);
    frame.style.setProperty('--stage-tilt-y', `${(px * 6).toFixed(2)}deg`);
    frame.style.setProperty('--stage-shift-x', `${(px * 8).toFixed(2)}px`);
    frame.style.setProperty('--stage-shift-y', `${(py * 6).toFixed(2)}px`);
  });

  scene.addEventListener('pointerleave', reset);
  reset();
}

function bootstrap() {
  initNav();
  initScrollProgress();
  initReveal();
  initCommandTerminal();
  initCopyButtons();
  initStageTilt();
}

bootstrap();
