/**
 * GrapesJS multi-page builder — static GitHub Pages (no Jekyll).
 * Sections: repo + storage keys, GitHub API, HTML export, link traits,
 * page helpers, editor init + blocks + commands, menu + publish UI.
 */

(function () {
  'use strict';

  // --- Config & keys ---
  const STORAGE_KEY_TOKEN = 'grapes_publish_token';
  const PROJECT_STORAGE_KEY = 'gjs-sober-living-builder-v1';
  const DEFAULT_BRANCH = 'main';

  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 4200);
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  function detectRepoFromUrl() {
    const host = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    let owner = '';
    let repo = '';

    if (host.endsWith('github.io')) {
      owner = host.replace('.github.io', '');
      repo = pathParts[0] || `${owner}.github.io`;
    }

    return { owner, repo, branch: DEFAULT_BRANCH };
  }

  const repoInfo = detectRepoFromUrl();

  // --- GitHub Contents API ---
  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function getExistingFileSha(owner, repo, branch, path, token) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub lookup failed (${res.status}) for ${path}`);

    const data = await res.json();
    return data.sha;
  }

  async function uploadFileToGitHub(owner, repo, branch, path, content, token) {
    let sha = await getExistingFileSha(owner, repo, branch, path, token);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload = {
        message: `Publish ${path} from GrapesJS builder`,
        content: utf8ToBase64(content),
        branch,
      };

      if (sha) payload.sha = sha;

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) return;
      if (res.status === 409 && attempt === 0) {
        sha = await getExistingFileSha(owner, repo, branch, path, token);
        continue;
      }

      const errorText = await res.text();
      throw new Error(`Publish failed (${res.status}) for ${path}: ${errorText}`);
    }
  }

  // --- Page filenames & export HTML ---
  function getPageFilename(page, index) {
    if (!page) return 'index.html';
    const name = page.get('name') || page.getId() || `page-${index + 1}`;
    const slug = page.get('slug') || slugify(name);
    return index === 0 ? 'index.html' : `${slug || `page-${index + 1}`}.html`;
  }

  function getPageFileMap(editor) {
    return editor.Pages.getAll().map((page, index) => ({
      id: page.getId(),
      name: page.get('name') || page.getId(),
      filename: getPageFilename(page, index),
    }));
  }

  function resolveInternalHref(editor, pageId) {
    const pages = editor.Pages.getAll();
    const idx = pages.findIndex(pg => pg.getId() === pageId);
    if (idx < 0) return '';
    return getPageFilename(pages[idx], idx);
  }

  function getExportHtml(editor, title) {
    const html = editor.getHtml();
    const css = editor.getCss();

    const safeTitle = title || 'Site';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle.replace(/</g, '')}</title>
  <style>
${css}
  </style>
</head>
<body>
${html}
</body>
</html>`;
  }

  function collectPagesForExport(editor) {
    const activePage = editor.Pages.getSelected();
    const output = editor.Pages.getAll().map((page, index) => {
      editor.Pages.select(page);
      const pageTitle = page.get('name') || `Page ${index + 1}`;
      return {
        id: page.getId(),
        name: pageTitle,
        filename: getPageFilename(page, index),
        html: getExportHtml(editor, pageTitle),
      };
    });

    if (activePage) editor.Pages.select(activePage);
    return output;
  }

  // --- Link traits (anchors + buttons) ---
  function withInternalLinkTraits(defaults) {
    const baseTraits = defaults.traits || [];
    const traitNames = baseTraits.map(tr => (typeof tr === 'string' ? tr : tr.name));
    if (traitNames.includes('linkType')) return baseTraits;

    const extra = [
      {
        type: 'select',
        name: 'linkType',
        label: 'Link Type',
        options: [
          { id: 'external', label: 'External URL' },
          { id: 'internal', label: 'Internal Page' },
        ],
        changeProp: 1,
      },
    ];

    if (!traitNames.includes('href')) {
      extra.push({
        type: 'text',
        name: 'href',
        label: 'External URL',
        placeholder: 'https://example.com',
      });
    }

    extra.push({
      type: 'select',
      name: 'internalPage',
      label: 'Internal Page',
      options: [{ id: '', label: 'Select page' }],
      changeProp: 1,
    });

    return [...baseTraits, ...extra];
  }

  function ensureLinkBehavior(editor) {
    const domc = editor.DomComponents;
    const defaultType = domc.getType('default');

    function extendType(typeName) {
      const type = domc.getType(typeName);
      if (!type) return;

      domc.addType(typeName, {
        model: type.model.extend(
          {
            defaults: {
              ...type.model.prototype.defaults,
              traits: withInternalLinkTraits(type.model.prototype.defaults),
              linkType: 'external',
              internalPage: '',
            },

            init() {
              const syncHref = () => {
                const linkType = this.get('linkType') || 'external';
                const attrs = { ...(this.getAttributes() || {}) };
                const tag = (this.get('tagName') || '').toLowerCase();

                if (linkType === 'internal') {
                  const pageId = this.get('internalPage');
                  const targetHref = resolveInternalHref(editor, pageId);
                  attrs.href = targetHref || '#';
                  if (tag === 'button') {
                    attrs.onclick = targetHref
                      ? `window.location.href='${String(targetHref).replace(/'/g, "\\'")}'`
                      : '';
                  }
                } else {
                  const href = this.get('href') != null ? this.get('href') : attrs.href || '#';
                  attrs.href = href;
                  if (tag === 'button') {
                    attrs.onclick =
                      href && href !== '#'
                        ? `window.location.href='${String(href).replace(/'/g, "\\'")}'`
                        : '';
                  } else {
                    delete attrs.onclick;
                  }
                }

                this.setAttributes(attrs);
              };

              this.listenTo(this, 'change:linkType change:attributes:href change:internalPage change:href', syncHref);
              queueMicrotask(syncHref);
            },
          },
          {
            isComponent: type.model.isComponent || defaultType.model.isComponent,
          }
        ),
        view: type.view,
      });
    }

    extendType('link');
    extendType('button');
  }

  function refreshInternalPageTraitOptions(editor) {
    const pageOptions = getPageFileMap(editor).map(page => ({
      id: page.id,
      label: `${page.name} (${page.filename})`,
    }));

    const wrapper = editor.getWrapper();
    if (!wrapper) return;

    const components = [...wrapper.find('a'), ...wrapper.find('button')];

    components.forEach(component => {
      const traits = component.get('traits');
      if (!traits || typeof traits.each !== 'function') return;
      traits.each(trait => {
        if (trait.get('name') === 'internalPage') {
          trait.set('options', [{ id: '', label: 'Select page' }, ...pageOptions]);
        }
      });
    });
  }

  // --- Default blocks ---
  function registerBlocks(editor) {
    const bm = editor.BlockManager;
    const cat = 'Site';

    bm.add('blk-hero', {
      label: 'Hero Section',
      category: cat,
      content:
        '<section class="hero-section" style="padding:64px 24px;text-align:center;background:linear-gradient(135deg,#1e3a5f,#0f172a);color:#fff;">' +
        '<h1 style="margin:0 0 12px;font-size:2.25rem;">Your headline</h1>' +
        '<p style="margin:0 0 20px;opacity:0.9;">Supporting text for your sober living community.</p>' +
        '<a href="#" class="btn-primary" style="display:inline-block;padding:12px 22px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Get started</a>' +
        '</section>',
    });

    bm.add('blk-section', {
      label: 'Section',
      category: cat,
      content:
        '<section style="padding:48px 24px;max-width:960px;margin:0 auto;">' +
        '<h2 style="margin:0 0 12px;">Section title</h2>' +
        '<p style="margin:0;line-height:1.6;color:#374151;">Add your content here.</p>' +
        '</section>',
    });

    bm.add('blk-columns', {
      label: '2 Columns',
      category: cat,
      content:
        '<div class="row" style="display:flex;flex-wrap:wrap;gap:24px;padding:24px;max-width:960px;margin:0 auto;">' +
        '<div style="flex:1 1 240px;min-width:200px;"><h3>Column one</h3><p>Text here.</p></div>' +
        '<div style="flex:1 1 240px;min-width:200px;"><h3>Column two</h3><p>Text here.</p></div>' +
        '</div>',
    });

    bm.add('blk-grid-3', {
      label: '3 Columns',
      category: cat,
      content:
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;padding:24px;max-width:1100px;margin:0 auto;">' +
        '<div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;"><h4 style="margin:0 0 8px;">Card 1</h4><p style="margin:0;">Description.</p></div>' +
        '<div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;"><h4 style="margin:0 0 8px;">Card 2</h4><p style="margin:0;">Description.</p></div>' +
        '<div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;"><h4 style="margin:0 0 8px;">Card 3</h4><p style="margin:0;">Description.</p></div>' +
        '</div>',
    });

    bm.add('blk-text', {
      label: 'Text',
      category: cat,
      content: '<p style="margin:12px 0;line-height:1.7;color:#374151;">Double-click to edit this paragraph.</p>',
    });

    bm.add('blk-image', {
      label: 'Image',
      category: cat,
      content: { type: 'image', style: { width: '100%', maxWidth: '640px', height: 'auto' } },
    });

    bm.add('blk-button', {
      label: 'Button',
      category: cat,
      content:
        '<a href="#" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Button</a>',
    });

    bm.add('blk-form', {
      label: 'Contact Form',
      category: cat,
      content:
        '<form style="max-width:480px;padding:24px;border:1px solid #e5e7eb;border-radius:10px;">' +
        '<h3 style="margin:0 0 16px;">Contact us</h3>' +
        '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.85rem;margin-bottom:4px;">Name</label><input type="text" name="name" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;"/></div>' +
        '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.85rem;margin-bottom:4px;">Email</label><input type="email" name="email" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;"/></div>' +
        '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.85rem;margin-bottom:4px;">Message</label><textarea name="message" rows="4" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;"></textarea></div>' +
        '<button type="submit" style="padding:10px 18px;background:#111827;color:#fff;border:none;border-radius:8px;cursor:pointer;">Send</button>' +
        '</form>',
    });

    bm.add('blk-navbar', {
      label: 'Navbar',
      category: cat,
      content:
        '<nav style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#0f172a;color:#fff;">' +
        '<span style="font-weight:700;">Site name</span>' +
        '<div style="display:flex;gap:16px;">' +
        '<a href="index.html" style="color:#e5e7eb;text-decoration:none;">Home</a>' +
        '<a href="#" style="color:#e5e7eb;text-decoration:none;">About</a>' +
        '<a href="#" style="color:#e5e7eb;text-decoration:none;">Contact</a>' +
        '</div></nav>',
    });

    bm.add('blk-footer', {
      label: 'Footer',
      category: cat,
      content:
        '<footer style="padding:32px 24px;background:#111827;color:#9ca3af;text-align:center;font-size:0.9rem;">' +
        '<p style="margin:0;">© Your organization. All rights reserved.</p>' +
        '</footer>',
    });
  }

  function registerCommands(editor) {
    editor.Commands.add('app:clear-canvas', {
      run(ed) {
        if (!window.confirm('Clear everything on this page?')) return;
        ed.setComponents('');
        ed.setStyle('');
        toast('Canvas cleared for this page.');
      },
    });
  }

  function createNewPage(editor) {
    const name = window.prompt('New page name (e.g. About):', 'New Page');
    if (!name) return;

    const slugInput = window.prompt('URL slug (e.g. about). Leave blank to auto-generate:', slugify(name));
    const slug = slugify(slugInput || name);
    const id = `page-${Date.now()}`;

    const page = editor.Pages.add({ id, name: name.trim(), slug });
    editor.Pages.select(page);
    editor.setComponents(
      `<section style="padding:40px 20px;max-width:900px;margin:0 auto;"><h1 style="margin-top:0;">${name.trim()}</h1><p>Start building this page.</p></section>`
    );
    refreshInternalPageTraitOptions(editor);
    toast(`Created page “${name.trim()}”.`);
  }

  function ensureDefaultHomeContent(editor) {
    const home = editor.Pages.getAll().at(0);
    if (!home) return;

    editor.Pages.select(home);
    const wrapper = editor.getWrapper();
    if (!wrapper || wrapper.components().length) return;

    editor.setComponents(`
      <section style="padding: 48px 20px; text-align: center; max-width: 720px; margin: 0 auto;">
        <h1 style="margin: 0 0 12px;">Welcome</h1>
        <p style="margin: 0 0 20px; color: #4b5563;">Build pages with blocks on the left, styles and traits on the right. Use <strong>Menu</strong> for layers, devices, and import/export.</p>
        <a href="#" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Primary button</a>
      </section>
    `);
  }

  // --- Editor ---
  const editor = grapesjs.init({
    container: '#gjs',
    fromElement: false,
    height: '100%',
    width: 'auto',
    noticeOnUnload: false,

    storageManager: {
      type: 'local',
      autosave: true,
      autoload: true,
      stepsBeforeSave: 1,
      options: {
        local: {
          key: PROJECT_STORAGE_KEY,
        },
      },
    },

    pageManager: {
      pages: [{ id: 'home', name: 'Home', slug: 'home' }],
    },

    blockManager: {
      appendTo: '#blocks-host',
    },

    styleManager: {
      appendTo: '#styles-host',
      sectors: [
        {
          name: 'General',
          open: false,
          buildProps: ['display', 'float', 'position', 'top', 'right', 'left', 'bottom', 'z-index'],
        },
        {
          name: 'Dimension',
          open: false,
          buildProps: [
            'width',
            'height',
            'max-width',
            'min-height',
            'margin',
            'padding',
          ],
          properties: [
            {
              type: 'integer',
              name: 'min-height',
              units: ['px', '%', 'vh'],
              defaults: 0,
              min: 0,
            },
          ],
        },
        {
          name: 'Typography',
          open: false,
          buildProps: [
            'font-family',
            'font-size',
            'font-weight',
            'letter-spacing',
            'color',
            'line-height',
            'text-align',
            'text-decoration',
            'text-shadow',
          ],
        },
        {
          name: 'Decorations',
          open: false,
          buildProps: [
            'background-color',
            'border-radius',
            'border',
            'box-shadow',
            'background',
          ],
        },
        {
          name: 'Extra',
          open: false,
          buildProps: ['transition', 'perspective', 'transform'],
        },
      ],
    },

    traitManager: {
      appendTo: '#traits-host',
    },

    layerManager: {
      appendTo: '#menu-layers',
    },

    deviceManager: {
      appendTo: '#menu-devices',
      devices: [
        { name: 'Desktop', width: '' },
        { name: 'Tablet', width: '820px', widthMedia: '992px' },
        { name: 'Mobile', width: '390px', widthMedia: '575px' },
      ],
    },

    selectorManager: {
      componentFirst: true,
    },

    panels: { defaults: [] },

    plugins: [
      'gjs-blocks-basic',
      'gjs-plugin-forms',
      'gjs-navbar',
      'grapesjs-parser-postcss',
    ],

    pluginsOpts: {
      'gjs-blocks-basic': { flexGrid: true },
      'gjs-plugin-forms': {},
      'gjs-navbar': {},
      'grapesjs-parser-postcss': {},
    },
  });

  ensureLinkBehavior(editor);
  registerBlocks(editor);
  registerCommands(editor);

  ensureDefaultHomeContent(editor);
  refreshInternalPageTraitOptions(editor);

  editor.on('storage:store', () => toast('Saved locally.'));
  editor.on('component:add', model => {
    const tag = (model.get('tagName') || '').toLowerCase();
    if (tag === 'a' || tag === 'button') {
      setTimeout(() => refreshInternalPageTraitOptions(editor), 0);
    }
  });

  // --- Right panel tabs ---
  const tabStyles = document.getElementById('tab-styles');
  const tabTraits = document.getElementById('tab-traits');
  const panelStyles = document.getElementById('panel-styles');
  const panelTraits = document.getElementById('panel-traits');

  function activateRightTab(which) {
    const isStyles = which === 'styles';
    if (tabStyles) tabStyles.classList.toggle('is-active', isStyles);
    if (tabTraits) tabTraits.classList.toggle('is-active', !isStyles);
    if (panelStyles) panelStyles.classList.toggle('panel__body--hidden', !isStyles);
    if (panelTraits) panelTraits.classList.toggle('panel__body--hidden', isStyles);
  }

  if (tabStyles) tabStyles.addEventListener('click', () => activateRightTab('styles'));
  if (tabTraits) tabTraits.addEventListener('click', () => activateRightTab('traits'));
  activateRightTab('styles');

  // --- Menu dropdown ---
  const menuToggle = document.getElementById('menu-toggle');
  const menuDropdown = document.getElementById('menu-dropdown');

  if (menuToggle && menuDropdown) {
    menuToggle.addEventListener('click', e => {
      e.stopPropagation();
      const open = menuDropdown.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.menu-wrap')) {
        menuDropdown.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Pages (in menu)
  const pageSelector = document.getElementById('page-selector');
  function refreshPageSelector() {
    if (!pageSelector) return;
    const pages = editor.Pages.getAll();
    const selected = editor.Pages.getSelected();
    pageSelector.innerHTML = '';
    pages.forEach((page, index) => {
      const option = document.createElement('option');
      option.value = page.getId();
      option.textContent = `${index + 1}. ${page.get('name') || page.getId()}`;
      if (selected && selected.getId() === page.getId()) option.selected = true;
      pageSelector.appendChild(option);
    });
  }

  refreshPageSelector();

  editor.on('page', () => {
    refreshPageSelector();
    refreshInternalPageTraitOptions(editor);
  });
  editor.on('page:select', () => {
    refreshPageSelector();
    refreshInternalPageTraitOptions(editor);
  });

  if (pageSelector) {
    pageSelector.addEventListener('change', e => {
      const target = editor.Pages.get(e.target.value);
      if (target) editor.Pages.select(target);
    });
  }

  document.getElementById('add-page')?.addEventListener('click', () => {
    createNewPage(editor);
    refreshPageSelector();
  });

  document.getElementById('rename-page')?.addEventListener('click', () => {
    const page = editor.Pages.getSelected();
    if (!page) return;

    const nextName = window.prompt('Rename page:', page.get('name') || page.getId());
    if (!nextName) return;

    const nextSlugInput = window.prompt('Slug:', page.get('slug') || slugify(nextName));
    page.set('name', nextName.trim());
    page.set('slug', slugify(nextSlugInput || nextName));

    refreshPageSelector();
    refreshInternalPageTraitOptions(editor);
    toast(`Renamed to “${nextName.trim()}”.`);
  });

  document.getElementById('delete-page')?.addEventListener('click', () => {
    const pages = editor.Pages.getAll();
    if (pages.length <= 1) {
      toast('At least one page is required.');
      return;
    }

    const selected = editor.Pages.getSelected();
    if (!selected) return;

    if (!window.confirm(`Delete page “${selected.get('name') || selected.getId()}”?`)) return;

    editor.Pages.remove(selected);
    const first = editor.Pages.getAll().at(0);
    if (first) editor.Pages.select(first);

    refreshPageSelector();
    refreshInternalPageTraitOptions(editor);
    toast('Page deleted.');
  });

  document.getElementById('cmd-clear-canvas')?.addEventListener('click', () => {
    editor.runCommand('app:clear-canvas');
  });

  // Settings: token
  const tokenInput = document.getElementById('github-token');
  const savedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (savedToken && tokenInput) tokenInput.placeholder = 'Token saved (enter new to replace)';

  document.getElementById('save-token')?.addEventListener('click', () => {
    const token = tokenInput?.value.trim() || '';
    if (!token) {
      toast('Paste a token first.');
      return;
    }
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
    if (tokenInput) tokenInput.value = '';
    toast('Token saved locally.');
  });

  // Import / Export
  document.getElementById('import-html-file')?.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const inner = bodyMatch ? bodyMatch[1] : text;
      editor.setComponents(inner);
      toast(`Imported HTML from ${file.name}`);
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('import-html-paste')?.addEventListener('click', () => {
    const ta = document.getElementById('import-html-textarea');
    const raw = ta?.value.trim() || '';
    if (!raw) {
      toast('Paste HTML first.');
      return;
    }
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const inner = bodyMatch ? bodyMatch[1] : raw;
    editor.setComponents(inner);
    toast('Imported HTML from clipboard area.');
  });

  document.getElementById('copy-html')?.addEventListener('click', async () => {
    try {
      const page = editor.Pages.getSelected();
      const title = page ? page.get('name') || 'Page' : 'Page';
      await navigator.clipboard.writeText(getExportHtml(editor, title));
      toast('Current page HTML copied.');
    } catch {
      toast('Clipboard blocked; use Download instead.');
    }
  });

  document.getElementById('download-html')?.addEventListener('click', () => {
    const selected = editor.Pages.getSelected();
    const allPages = editor.Pages.getAll();
    let idx = 0;
    allPages.forEach((p, i) => {
      if (selected && p.getId() === selected.getId()) idx = i;
    });
    const filename = getPageFilename(selected, idx);

    const pageTitle = selected ? selected.get('name') || filename : 'Page';
    const blob = new Blob([getExportHtml(editor, pageTitle)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Downloaded ${filename}`);
  });

  async function downloadSiteZip() {
    if (typeof JSZip === 'undefined') {
      toast('ZIP library not loaded.');
      return;
    }
    const zip = new JSZip();
    const pages = collectPagesForExport(editor);
    pages.forEach(p => zip.file(p.filename, p.html));
    zip.file('.nojekyll', '');
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'site-export.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`ZIP with ${pages.length} page(s) downloaded.`);
  }

  document.getElementById('download-site-zip')?.addEventListener('click', () => {
    downloadSiteZip().catch(err => toast(`ZIP error: ${err.message}`));
  });

  document.getElementById('download-site')?.addEventListener('click', () => {
    const pages = collectPagesForExport(editor);
    pages.forEach(page => {
      const blob = new Blob([page.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = page.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    toast(`Exported ${pages.length} HTML file(s).`);
  });

  // Publish
  async function publishToGitHub() {
    const token = (tokenInput?.value.trim() || localStorage.getItem(STORAGE_KEY_TOKEN) || '');
    const { owner, repo, branch } = repoInfo;

    if (!owner || !repo) {
      toast('Open this builder from your GitHub Pages URL to publish, or use Export ZIP.');
      return;
    }
    if (!token) {
      toast('Add a GitHub token under Menu → Settings.');
      return;
    }

    try {
      const pages = collectPagesForExport(editor);
      toast(`Publishing ${pages.length} page(s)…`);

      for (const page of pages) {
        await uploadFileToGitHub(owner, repo, branch, page.filename, page.html, token);
      }

      await uploadFileToGitHub(owner, repo, branch, '.nojekyll', '', token);

      toast(`Published ${pages.length} page(s) + .nojekyll.`);
    } catch (err) {
      toast(`Publish error: ${err.message}`);
    }
  }

  document.getElementById('publish-github')?.addEventListener('click', () => {
    publishToGitHub();
  });

  if (!repoInfo.owner || !repoInfo.repo) {
    toast('Tip: use your github.io URL for one-click publish, or export a ZIP.');
  }
})();
