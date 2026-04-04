const root = document.documentElement;
const pageShell = document.querySelector('[data-page-shell]');
const scrollProgress = document.querySelector('[data-scroll-progress]');
const repoUrl = 'https://github.com/NatsuFox/ClaudeChrome';
const logoSrc = './assets/logo-transparent.svg';
const lexiconUrl = './lexicon.json';
const navTargets = ['#top', '#surface', '#use-cases', '#workflows', '#demos', '#faq'];
const footerTargets = ['#top', '#surface', '#use-cases', '#workflows', '#demos'];
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

root.classList.add('js');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

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
  const defaultLabel = button.dataset.copyDefault || (label ? label.textContent : '');
  const successLabel = button.dataset.copySuccess || defaultLabel;

  button.classList.add('is-copied');
  if (label) {
    label.textContent = successLabel;
  }

  window.setTimeout(() => {
    button.classList.remove('is-copied');
    if (label) {
      label.textContent = defaultLabel;
    }
  }, 900);
}

function renderGithubIcon() {
  return `
    <span class="github-link-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="presentation">
        <path d="M12 .75A11.25 11.25 0 0 0 .75 12a11.25 11.25 0 0 0 7.7 10.69c.56.1.76-.24.76-.54 0-.27-.01-.98-.02-1.92-3.13.68-3.8-1.51-3.8-1.51-.5-1.29-1.24-1.63-1.24-1.63-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.15 1.72 1.15 1 .1 1.94 1.22 1.94 1.22.9 1.53 2.37 1.09 2.95.83.09-.72.35-1.21.63-1.49-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.15-3.02-.12-.28-.5-1.4.11-2.92 0 0 .94-.3 3.08 1.15a10.63 10.63 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.52.23 2.64.11 2.92.72.79 1.15 1.79 1.15 3.02 0 4.32-2.63 5.28-5.14 5.56.36.31.68.91.68 1.84 0 1.33-.01 2.4-.01 2.73 0 .3.2.65.77.54A11.25 11.25 0 0 0 23.25 12 11.25 11.25 0 0 0 12 .75Z"></path>
      </svg>
    </span>
  `;
}

function renderEyebrow(eyebrow) {
  return `
    <p class="eyebrow">
      <span class="eyebrow-cn">${escapeHtml(eyebrow.primary)}</span>
      <span class="eyebrow-sep">·</span>
      <span class="eyebrow-en">${escapeHtml(eyebrow.secondary)}</span>
    </p>
  `;
}

function renderSectionCopy(section, extraClass = '') {
  return `
    <div class="section-copy${extraClass}">
      ${renderEyebrow(section.eyebrow)}
      <h2>${escapeHtml(section.title)}</h2>
      ${section.body ? `<p class="section-english">${escapeHtml(section.body)}</p>` : ''}
    </div>
  `;
}

function renderHeader(copy, localeKey) {
  const languageSwitchHref = localeKey.toLowerCase().startsWith('zh') ? './index.html' : './index-zh.html';
  const navLinks = copy.header.navItems
    .map(
      (item, index) => `
        <a href="${navTargets[index] || '#'}" data-nav-link>
          <span class="nav-stack">
            <span class="nav-label">${escapeHtml(item.label)}</span>
            <span class="nav-sub">${escapeHtml(item.subLabel)}</span>
          </span>
        </a>
      `
    )
    .join('');

  return `
    <header class="site-header glass-panel">
      <a class="brand" href="#top" aria-label="${escapeHtml(copy.header.brand.ariaLabel)}">
        <span class="brand-mark" aria-hidden="true">
          <img src="${logoSrc}" alt="" />
        </span>
        <span class="brand-lockup">
          <strong>${escapeHtml(copy.header.brand.name)}</strong>
          <small>${escapeHtml(copy.header.brand.tagline)}</small>
        </span>
      </a>

      <button
        class="nav-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="site-nav"
        aria-label="${escapeHtml(copy.header.navToggleAriaLabel)}"
      >
        <span></span>
        <span></span>
      </button>

      <nav class="site-nav" id="site-nav" aria-label="${escapeHtml(copy.header.navAriaLabel)}">
        ${navLinks}
        <a class="lang-switch" href="${languageSwitchHref}">${escapeHtml(copy.header.languageSwitchLabel)}</a>
        <a class="nav-cta repo-link" href="${repoUrl}" target="_blank" rel="noreferrer">
          ${renderGithubIcon()}
          <span class="nav-stack">
            <span class="nav-label">${escapeHtml(copy.header.repoLink.label)}</span>
            <span class="nav-sub">${escapeHtml(copy.header.repoLink.subLabel)}</span>
          </span>
        </a>
      </nav>
    </header>
  `;
}

function renderCommandTerminal(commandTerminal) {
  const tabs = commandTerminal.tabs
    .map(
      (tab, index) => `
        <button
          class="terminal-tab${index === 0 ? ' is-active' : ''}"
          type="button"
          role="tab"
          aria-selected="${String(index === 0)}"
          data-command-tab="${escapeHtml(tab.key)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `
    )
    .join('');

  const panels = commandTerminal.tabs
    .map(
      (tab, index) => `
        <div
          class="command-panel${index === 0 ? ' is-active' : ''}"
          data-command-panel="${escapeHtml(tab.key)}"
          data-clipboard="${escapeHtml(tab.clipboard)}"
        >
          <span class="prompt">$</span>
          <code>${escapeHtml(tab.display)}</code>
        </div>
      `
    )
    .join('');

  return `
    <div class="hero-terminal" data-command-terminal>
      <div class="terminal-toolbar">
        <div class="terminal-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="terminal-tabs" role="tablist" aria-label="${escapeHtml(commandTerminal.tablistAriaLabel)}">
          ${tabs}
        </div>
        <button
          class="copy-button"
          type="button"
          aria-label="${escapeHtml(commandTerminal.copyButtonAriaLabel)}"
          data-command-copy
          data-copy-default="${escapeHtml(commandTerminal.copyLabel)}"
          data-copy-success="${escapeHtml(commandTerminal.copiedLabel)}"
        >
          <span data-copy-label>${escapeHtml(commandTerminal.copyLabel)}</span>
        </button>
      </div>
      <div class="terminal-body">
        ${panels}
      </div>
    </div>
  `;
}

function renderHero(copy) {
  const copyBlocks = copy.hero.copyBlocks
    .map(
      (block, index) => `
        <div class="hero-copy-block${index === 1 ? ' hero-copy-block-alt' : ''}">
          <h2>${escapeHtml(block.title)}</h2>
          <p>${escapeHtml(block.body)}</p>
        </div>
      `
    )
    .join('');

  const metrics = copy.hero.metrics
    .map(
      (metric) => `
        <article class="interactive-card">
          <strong>${escapeHtml(metric.title)}</strong>
          <span>${escapeHtml(metric.subtitle)}</span>
          <small>${escapeHtml(metric.body)}</small>
        </article>
      `
    )
    .join('');

  return `
    <section class="hero" id="top" data-section="Intro">
      <div class="hero-intro glass-panel section-animate" data-stage-copy>
        <div class="hero-logo-lockup">
          <img src="${logoSrc}" alt="${escapeHtml(copy.hero.brand.logoAlt)}" />
          <div class="hero-logo-copy">
            <strong>${escapeHtml(copy.hero.brand.name)}</strong>
            <span>${escapeHtml(copy.hero.brand.tagline)}</span>
          </div>
        </div>

        ${renderEyebrow(copy.hero.eyebrow)}

        <h1 class="lead-sentence">${escapeHtml(copy.hero.title)}</h1>
        <p class="lead-english">${escapeHtml(copy.hero.body)}</p>

        <div class="hero-actions">
          <a class="button primary" href="#use-cases">${escapeHtml(copy.hero.actions.primary)}</a>
          <a class="button secondary" href="#demos">${escapeHtml(copy.hero.actions.secondary)}</a>
        </div>

        <div class="hero-copy-grid">
          ${copyBlocks}
        </div>

        <p class="command-label">
          <span>${escapeHtml(copy.hero.commandLabel.title)}</span>
          <span class="command-label-en">${escapeHtml(copy.hero.commandLabel.subtitle)}</span>
        </p>
        ${renderCommandTerminal(copy.hero.commandTerminal)}

        <div class="hero-metrics">
          ${metrics}
        </div>
      </div>

      ${renderStage(copy.stage)}
    </section>
  `;
}

function renderStage(stage) {
  const pageCards = stage.pageCards
    .map(
      (card) => `
        <article>
          <span class="mini-label">${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.title)}</strong>
          <p>${escapeHtml(card.body)}</p>
        </article>
      `
    )
    .join('');

  const toolbarActions = stage.toolbarActions.map((action) => `<span>${escapeHtml(action)}</span>`).join('');

  const workspaces = stage.workspaces
    .map(
      (workspace, index) => `
        <div class="workspace-chip${index === 0 ? ' is-active' : ''}">
          <strong>${escapeHtml(workspace.title)}</strong>
          <small>${escapeHtml(workspace.subtitle)}</small>
        </div>
      `
    )
    .join('');

  const panes = stage.panes
    .map(
      (pane, index) => `
        <article class="pane-card ${index === 0 ? 'pane-claude' : 'pane-codex'}">
          <header>
            <span class="pane-badge">${escapeHtml(pane.badge)}</span>
            <span class="pane-binding">${escapeHtml(pane.binding)}</span>
          </header>
          <div class="pane-body">
            <div class="pane-line"><span class="pane-prompt">$</span><code>${escapeHtml(pane.command)}</code></div>
            <div class="pane-output">${escapeHtml(pane.output)}</div>
          </div>
        </article>
      `
    )
    .join('');

  const notes = stage.notes
    .map(
      (note) => `
        <article class="note-card interactive-card">
          <p class="card-label">${escapeHtml(note.label)}</p>
          <h3>${escapeHtml(note.title)}</h3>
          <p>${escapeHtml(note.body)}</p>
        </article>
      `
    )
    .join('');

  return `
    <div class="hero-stage glass-panel section-animate delay-1" data-stage-scene>
      <div class="stage-header">
        ${renderEyebrow(stage.eyebrow)}
        <h2>${escapeHtml(stage.title)}</h2>
        <p class="section-english">${escapeHtml(stage.body)}</p>
      </div>

      <div class="stage-scene">
        <article class="browser-frame interactive-card" role="img" aria-label="${escapeHtml(stage.browserFrameAriaLabel)}">
          <div class="browser-bar">
            <div class="browser-dots" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="browser-address">${escapeHtml(stage.browserAddress)}</div>
            <div class="browser-state">${escapeHtml(stage.browserState)}</div>
          </div>
          <div class="browser-body">
            <div class="browser-page">
              <div class="page-ribbon">${escapeHtml(stage.pageRibbon)}</div>
              <div class="page-grid">
                ${pageCards}
              </div>
            </div>

            <aside class="sidepanel-frame">
              <div class="sidepanel-toolbar">
                <div class="status-pill is-live"><span></span>${escapeHtml(stage.statusPill)}</div>
                <div class="toolbar-actions">
                  ${toolbarActions}
                </div>
              </div>

              <div class="workspace-strip">
                ${workspaces}
              </div>

              <div class="pane-stack">
                ${panes}
              </div>
            </aside>
          </div>
        </article>

        <div class="scene-notes">
          ${notes}
        </div>
      </div>
    </div>
  `;
}

function renderUseCases(useCases) {
  const cards = useCases.cards
    .map(
      (card) => `
        <article class="chapter-card interactive-card">
          <span class="chapter-index">${escapeHtml(card.index)}</span>
          <p class="card-label">${escapeHtml(card.label)}</p>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.body)}</p>
        </article>
      `
    )
    .join('');

  return `
    <section class="story section-animate delay-2" id="use-cases" data-section="Use Cases">
      ${renderSectionCopy(useCases, ' story-copy')}
      <div class="chapter-grid">
        ${cards}
      </div>
    </section>
  `;
}

function renderVisualReserve(visualReserve) {
  const shotFrameClasses = ['shot-frame', 'shot-frame shot-frame-alt', 'shot-frame shot-frame-diagram'];
  const shots = visualReserve.shots
    .map(
      (shot, index) => `
        <article class="shot-card interactive-card">
          <div class="${shotFrameClasses[index] || 'shot-frame'}">
            <div class="shot-overlay">
              <span class="shot-badge">${escapeHtml(shot.badge)}</span>
              <strong>${escapeHtml(shot.title)}</strong>
              <p>${escapeHtml(shot.body)}</p>
            </div>
          </div>
          <div class="shot-meta">
            <span class="path-label">${escapeHtml(shot.pathLabel)}</span>
            <code>${escapeHtml(shot.path)}</code>
          </div>
        </article>
      `
    )
    .join('');

  return `
    <section class="visual-reserve" id="surface" data-section="Product">
      <div class="glass-panel section-animate delay-3 reserve-shell">
        ${renderSectionCopy(visualReserve, ' reserve-copy')}
        <div class="reserve-grid">
          ${shots}
        </div>
      </div>
    </section>
  `;
}

function renderWorkflows(workflows) {
  const cards = workflows.cards
    .map(
      (card) => `
        <article class="evidence-card interactive-card">
          <p class="card-label">${escapeHtml(card.label)}</p>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.body)}</p>
        </article>
      `
    )
    .join('');

  return `
    <section class="architecture" id="workflows" data-section="Workflows">
      <div class="section-animate architecture-shell">
        ${renderSectionCopy(workflows, ' architecture-copy')}
        <div class="evidence-grid workflow-grid">
          ${cards}
        </div>
      </div>
    </section>
  `;
}

function renderDemos(demos) {
  const frameClasses = ['demo-shell-frame', 'demo-shell-frame demo-shell-frame-alt', 'demo-shell-frame demo-shell-frame-command'];
  const cards = demos.cards
    .map((card, index) => {
      const media = card.media
        ? `
            <div class="demo-media-wrap">
              <video
                class="demo-video"
                controls
                autoplay
                preload="metadata"
                playsinline
                muted
                loop
                aria-label="${escapeHtml(card.media.ariaLabel || card.title)}"
              >
                <source src="${escapeHtml(card.media.src)}" type="${escapeHtml(card.media.type || 'video/mp4')}" />
              </video>
            </div>
          `
        : '';

      return `
        <article class="demo-card interactive-card">
          <div class="${frameClasses[index] || 'demo-shell-frame'}">
            <div class="demo-shell-top">
              <div class="terminal-dots" aria-hidden="true"><span></span><span></span><span></span></div>
              <strong>${escapeHtml(card.shellTitle)}</strong>
            </div>
            ${media}
            <div class="demo-shell-body">
              ${card.lines
                .map(
                  (line) => `
                    <div class="demo-line"><span class="prompt">$</span><code>${escapeHtml(line)}</code></div>
                  `
                )
                .join('')}
            </div>
          </div>
          <div class="demo-copy">
            <p class="card-label">${escapeHtml(card.label)}</p>
            <h3>${escapeHtml(card.title)}</h3>
            <p>${escapeHtml(card.body)}</p>
          </div>
        </article>
      `;
    })
    .join('');

  return `
    <section class="demos" id="demos" data-section="Demos">
      <div class="section-animate delay-4 demos-shell">
        ${renderSectionCopy(demos)}
        <div class="demo-grid">
          ${cards}
        </div>
      </div>
    </section>
  `;
}

function renderTeams(teams) {
  const cards = teams.cards
    .map(
      (card) => `
        <article class="evidence-card interactive-card">
          <p class="card-label">${escapeHtml(card.label)}</p>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.body)}</p>
        </article>
      `
    )
    .join('');

  return `
    <section class="evidence dark-panel section-animate" data-section="Teams">
      ${renderSectionCopy(teams)}
      <div class="evidence-grid">
        ${cards}
      </div>
    </section>
  `;
}

function renderFaq(faq) {
  const items = faq.items
    .map(
      (item, index) => `
        <details class="faq-item interactive-card"${index === 0 ? ' open' : ''}>
          <summary>${escapeHtml(item.question)}</summary>
          <p>${escapeHtml(item.answer)}</p>
        </details>
      `
    )
    .join('');

  return `
    <section class="faq section-animate" id="faq" data-section="FAQ">
      ${renderSectionCopy(faq)}
      <div class="faq-list">
        ${items}
      </div>
    </section>
  `;
}

function renderFinalCta(finalCta) {
  return `
    <section class="final-cta glass-panel section-animate">
      <div class="final-copy">
        ${renderEyebrow(finalCta.eyebrow)}
        <h2>${escapeHtml(finalCta.title)}</h2>
        <p>${escapeHtml(finalCta.body)}</p>
      </div>
      <div class="final-actions">
        <a class="button primary" href="#use-cases">${escapeHtml(finalCta.primaryButtonLabel)}</a>
        <a class="button secondary repo-link" href="${repoUrl}" target="_blank" rel="noreferrer">
          ${renderGithubIcon()}
          <span>${escapeHtml(finalCta.repoButtonLabel)}</span>
        </a>
      </div>
    </section>
  `;
}

function renderFooter(footer) {
  const links = footer.links
    .map(
      (link, index) => `
        <a class="footer-link" href="${footerTargets[index] || '#'}">${escapeHtml(link.label)}</a>
      `
    )
    .join('');

  return `
    <footer class="site-footer">
      <div class="site-footer-inner">
        <p>${escapeHtml(footer.tagline)}</p>
        <div class="footer-nav">
          ${links}
          <a class="footer-link repo-link" href="${repoUrl}" target="_blank" rel="noreferrer">
            ${renderGithubIcon()}
            <span>${escapeHtml(footer.repoLabel)}</span>
          </a>
        </div>
      </div>
    </footer>
  `;
}

function renderPage(copy, localeKey) {
  if (!pageShell) {
    return;
  }

  pageShell.innerHTML = `
    ${renderHeader(copy, localeKey)}
    <main>
      ${renderHero(copy)}
      ${renderDemos(copy.demos)}
      ${renderUseCases(copy.useCases)}
      ${renderVisualReserve(copy.visualReserve)}
      ${renderWorkflows(copy.workflows)}
      ${renderTeams(copy.teams)}
      ${renderFaq(copy.faq)}
      ${renderFinalCta(copy.finalCta)}
    </main>
    ${renderFooter(copy.footer)}
  `;
}

function renderErrorState(message) {
  if (!pageShell) {
    return;
  }

  document.title = 'ClaudeChrome';
  pageShell.innerHTML = `
    <main>
      <section class="hero" id="top" data-section="Intro">
        <div class="hero-intro glass-panel section-animate is-visible" data-stage-copy>
          <div class="hero-logo-lockup">
            <img src="${logoSrc}" alt="ClaudeChrome logo" />
            <div class="hero-logo-copy">
              <strong>ClaudeChrome</strong>
              <span>${escapeHtml(message)}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}

function applyMeta(copy) {
  document.title = copy.meta.title;

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute('content', copy.meta.description);
  }
}

function resolveLocaleKey(lexicon) {
  const locales = lexicon.locales || {};
  const lang = document.documentElement.lang || lexicon.defaultLocale || 'en';
  const candidates = [lang, lang.toLowerCase(), lang.split('-')[0], lexicon.defaultLocale || 'en'];

  for (const candidate of candidates) {
    if (candidate && locales[candidate]) {
      return candidate;
    }
  }

  return Object.keys(locales)[0] || null;
}

function readInlineLexicon() {
  const inlineLexicon = window.__LANDING_LEXICON__;
  if (!inlineLexicon || typeof inlineLexicon !== 'object') {
    return null;
  }

  return inlineLexicon;
}

async function loadLexicon() {
  const inlineLexicon = readInlineLexicon();
  if (inlineLexicon) {
    return inlineLexicon;
  }

  const response = await fetch(lexiconUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${lexiconUrl}: ${response.status}`);
  }

  return response.json();
}

function initNav() {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');

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
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

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

function initDemoVideoAutoplay() {
  const videos = Array.from(document.querySelectorAll('.demo-video'));
  if (!videos.length) {
    return;
  }

  videos.forEach((video) => {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
  });

  if (prefersReducedMotion) {
    videos.forEach((video) => {
      video.removeAttribute('autoplay');
      video.pause();
    });
    return;
  }

  const tryPlay = (video) => {
    const result = video.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (!(video instanceof HTMLVideoElement)) {
          return;
        }

        if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
          tryPlay(video);
          return;
        }

        video.pause();
      });
    },
    {
      threshold: [0, 0.25, 0.55, 0.85],
      rootMargin: '0px 0px -10% 0px',
    }
  );

  videos.forEach((video) => observer.observe(video));
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

async function bootstrap() {
  try {
    const lexicon = await loadLexicon();
    const localeKey = resolveLocaleKey(lexicon);
    const copy = localeKey ? lexicon.locales[localeKey] : null;

    if (!copy) {
      throw new Error('Missing landing-page copy.');
    }

    applyMeta(copy);
    renderPage(copy, localeKey);
    initNav();
    initScrollProgress();
    initReveal();
    initCommandTerminal();
    initCopyButtons();
    initDemoVideoAutoplay();
    initStageTilt();
  } catch (error) {
    console.error(error);
    renderErrorState('Unable to load the landing page copy right now.');
    initScrollProgress();
    initReveal();
  }
}

bootstrap();
