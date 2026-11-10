import { expect, it } from 'vitest';
import { POST } from '@/app/api/world/create/from-source/stream/route';
it('retires the legacy pipeline without performing model work', async () => {
  const response = await POST();
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code: 'source_pipeline_retired' });
});
