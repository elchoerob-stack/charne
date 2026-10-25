import { describe, expect, it } from 'vitest';
import { parseRand, pct, rand, randShort, toCsvSafe } from './format-helpers';

describe('rand', () => {
  it('formats with space grouping and no decimals', () => {
    expect(rand(1_650_000_00)).toBe('R1 650 000');
    expect(rand(85_000)).toBe('R850');
    expect(rand(undefined)).toBe('—');
  });
  it('short form', () => {
    expect(randShort(1_650_000_00)).toBe('R1.65m');
    expect(randShort(850_000_00)).toBe('R850k');
  });
  it('parses what people type', () => {
    expect(parseRand('1650000')).toBe(1_650_000_00);
    expect(parseRand('R1 650 000')).toBe(1_650_000_00);
    expect(parseRand('1,65m')).toBe(1_650_000_00);
    expect(parseRand('850k')).toBe(850_000_00);
    expect(parseRand('')).toBeUndefined();
  });
  it('percent', () => {
    expect(pct(0.256)).toBe('26%');
    expect(pct(null)).toBe('—');
  });
  it('csv escapes', () => {
    expect(toCsvSafe([{ a: 'x,y', b: 'say "hi"', c: ['m'] }])).toBe('a,b,c\r\n"x,y","say ""hi""","[""m""]"');
  });
});
