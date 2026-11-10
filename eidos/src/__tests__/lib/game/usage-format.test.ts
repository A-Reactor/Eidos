import { expect, it } from 'vitest';
import { formatUsage } from '@/lib/game/usage-format';
it('formats K, M, B with one decimal and expands exact counts and two decimal cost',()=>{
 expect(formatUsage(314542,.51)).toBe('314.5K token - 0.5¥');
 expect(formatUsage(300100000,30.14)).toBe('300.1M token - 30.1¥');
 expect(formatUsage(1340000000,100)).toBe('1.3B token - 100.0¥');
 expect(formatUsage(314542,.51,true)).toBe('314542 token - 0.51¥');
 expect(formatUsage(999999,1)).toBe('1.0M token - 1.0¥');
});
