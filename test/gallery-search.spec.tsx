import fs from 'node:fs';
import { fireEvent, waitFor, within } from '@testing-library/react';

function mountPanel(directory: string, ma: object, scripts: string[]) {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const page = iframe.contentWindow as Window & typeof globalThis;
  const html = fs.readFileSync(directory + '/panel.html', 'utf8');
  page.document.open();
  page.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  page.document.close();
  Object.assign(page, {
    ma,
    matchMedia: () => ({ matches: true }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    fetch: vi.fn(async () => ({ ok: false })),
  });
  const run = () => {
    for (const script of scripts) page.eval(fs.readFileSync(directory + '/' + script, 'utf8'));
  };
  return { iframe, page, run };
}

it('filters Guizang works while keeping the same search field and caret during input', async () => {
  const { iframe, page, run } = mountPanel('guizang-design/gallery', {
    ready: Promise.resolve({}),
    context: () => ({ appearance: { locale: 'zh-CN' } }),
    on: vi.fn(),
    agent: { domain: { query: async () => ({
      version: '1', skills: [], columns: [], recipes: [], examples: [], voice: {},
      works: [{ id: 'one', title: '山间札记' }, { id: 'two', title: '城中见闻' }],
    }) } },
  }, ['i18n.js', 'app.js']);
  try {
    const routed = new Promise<void>(resolve => page.addEventListener('hashchange', () => resolve(), { once: true }));
    page.location.hash = '#/works';
    await routed;
    run();
    const panel = within(page.document.body);
    const search = await panel.findByRole('searchbox') as HTMLInputElement;
    expect(panel.getByRole('link', { name: /我的作品/ }).getAttribute('aria-current')).toBe('page');
    search.focus();
    search.value = '山间';
    search.setSelectionRange(1, 1);
    fireEvent.input(search, { isComposing: true });
    expect(panel.getByRole('searchbox')).toBe(search);
    expect(page.document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(1);
    fireEvent.input(search);
    expect(panel.getByText('山间札记')).toBeTruthy();
    await waitFor(() => expect(panel.queryByText('城中见闻')).toBeNull());
  } finally { iframe.remove(); }
});

it('disconnects Guizang banner drawing when leaving the overview', async () => {
  const { iframe, page, run } = mountPanel('guizang-design/gallery', {
    ready: Promise.resolve({}),
    context: () => ({ appearance: { locale: 'zh-CN' } }),
    on: vi.fn(),
    agent: { domain: { query: async () => ({
      version: '1', skills: [{ name: 'guizang-page-skill', title: '网页设计' }],
      works: [], columns: [], recipes: [], examples: [], voice: {},
    }) } },
  }, ['i18n.js', 'app.js']);
  const observe = vi.fn();
  const disconnect = vi.fn();
  Object.assign(page, { ResizeObserver: class { observe = observe; disconnect = disconnect; }, scrollTo: vi.fn() });
  Object.defineProperty(page.document, 'fonts', { value: { ready: Promise.resolve() } });
  vi.spyOn(page.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  try {
    run();
    const panel = within(page.document.body);
    await panel.findByRole('button', { name: /网页设计/ });
    expect(observe).toHaveBeenCalledTimes(1);
    // The iframe is about:blank in jsdom. Set the fragment directly to exercise
    // the production hashchange handler without document navigation.
    page.location.hash = (panel.getByRole('link', { name: '我的作品' }) as HTMLAnchorElement).hash;
    await panel.findByRole('searchbox');
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally { iframe.remove(); }
});
