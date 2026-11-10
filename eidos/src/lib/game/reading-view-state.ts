export interface ReadingViewState {
  query: string;
  location: string;
  expanded: string | null;
  onlyExcerpts: boolean;
  scrollTop: number;
  branch?: string;
}

export function loadReadingView(scope: string, currentId: string | null): ReadingViewState {
  const fallback = { query: '', location: '', expanded: currentId, onlyExcerpts: false, scrollTop: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(`eidos_reading_view:${scope}`) ?? 'null');
    if (!value || typeof value !== 'object') return fallback;
    return {
      query: typeof value.query === 'string' ? value.query : '',
      location: typeof value.location === 'string' ? value.location : '',
      expanded: typeof value.expanded === 'string' ? value.expanded : null,
      onlyExcerpts: value.onlyExcerpts === true,
      // Old pixels belong to the former reverse-order list, not this continuous route.
      scrollTop: value.layout === 'worldline-reader' && Number.isFinite(value.scrollTop) ? Math.max(0, value.scrollTop) : 0,
      branch: typeof value.branch === 'string' ? value.branch : '',
    };
  } catch { return fallback; }
}

export function saveReadingView(scope: string, view: ReadingViewState): void {
  // Reading preferences are optional; blocked browser storage must not block the story.
  try { localStorage.setItem(`eidos_reading_view:${scope}`, JSON.stringify({ ...view, layout: 'worldline-reader' })); } catch { /* In-memory view remains usable. */ }
}
