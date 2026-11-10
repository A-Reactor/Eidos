import type { SVGProps } from 'react';

const paths = {
  page: 'M5 4h10l4 4v12H5zM14 4v5h5M9 12l4 3-4 3',
  walk: 'M13 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 11l4-3 4 3h4M11 8l-2 7-4 6M9 15l6 1 2 5',
  voice: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3',
  stream: 'M3 7h10M3 12h15M3 17h10M17 4l4 3-4 3M17 14l4 3-4 3',
  save: 'M5 3h12l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8',
  undo: 'M8 4l-5 5 5 5M3 9h10a7 7 0 0 1 0 14',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  close: 'm6 6 12 12M6 18 18 6',
  back: 'm14 5-7 7 7 7M7 12h14',
  file: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6',
  attach: 'm8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M7 14l8-8',
  import: 'M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6',
  export: 'M12 15V3m-4 4 4-4 4 4M4 15v6h16v-6',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14z',
  editOff: 'm15 4 5 5M14 4l2-2 5 5-2 2M9 9l-5 5v6l5-1 6-6M3 3l18 18',
  plus: 'M12 4v16M4 12h16',
  check: 'm4 12 5 5L20 6',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 3v5h-5',
  history: 'M3 12a9 9 0 1 0 3-7M3 3v5h5M12 7v5l3 2',
  compare: 'M3 4h7v16H3zM14 4h7v16h-7M6 8h1M6 12h1M17 8h1M17 12h1',
  search: 'M15 15a7 7 0 1 0-10-10 7 7 0 0 0 10 10m0 0 6 6',
  next: 'm9 5 7 7-7 7',
  chevron: 'm6 9 6 6 6-6',
  clock: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0M12 7v5l3 2',
  alert: 'M12 3 2 21h20zM12 9v5m0 3v1',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  image: 'M3 3h18v18H3zM7 8h.01M3 16l6-6 6 7 3-3 3 3',
  layoutText: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  layoutImage: 'M3 4h18v16H3zM3 15h18M7 8h.01M10 15l5-6 6 6',
  panelCollapse: 'M3 4h18v16H3zM14 4v16m3-11 3 3-3 3',
  panelExpand: 'M3 4h18v16H3zM14 4v16m-4-11-3 3 3 3',
  maximize: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  minimize: 'M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
};
export type ActionIconName = keyof typeof paths;
export function ActionIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: ActionIconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}
