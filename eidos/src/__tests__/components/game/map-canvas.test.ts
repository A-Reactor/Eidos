// @vitest-environment jsdom
import React from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { MapCanvas } from '@/components/game/MapCanvas';
import type { PlayerMap } from '@/lib/game/player-map';
afterEach(cleanup);
it('groups many known places without drawing intersecting paths or persisting fictional coordinates', () => {
  const map: PlayerMap = { places: Array.from({ length: 36 }, (_, n) => ({ id: String(n), name: `地点${n}`, regionId: String(n % 3), regionName: `区域${n % 3}`, current: n === 0, visited: n < 12, reachable: n === 1 })), paths: Array.from({ length: 35 }, (_, n) => ({ from: String(n), to: String(n + 1), blocked: false })) };
  const select = vi.fn();
  const { container } = render(React.createElement(MapCanvas, { map, selected: '0', onSelect: select, zoom: 1, focusToken: 0 }));
  expect(screen.getAllByRole('button')).toHaveLength(36);
  expect(screen.getByRole('region', { name: '区域0' })).toBeTruthy();
  expect(container.querySelector('svg')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '选择地点：地点35' }));
  expect(select).toHaveBeenCalledWith('35');
  expect(map.paths).toHaveLength(35);
});
