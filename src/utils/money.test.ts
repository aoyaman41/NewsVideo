import { describe, expect, it } from 'vitest';
import { formatCost, formatJpyPerUsd } from './money';

// M5: 金額は円とドルを併記する(全画面でこの関数を使う)
describe('formatCost', () => {
  it('shows yen converted with the configured rate, followed by dollars', () => {
    expect(formatCost(0.51, 150)).toBe('約 77 円($0.51)');
    expect(formatCost(0.5, 150)).toBe('約 75 円($0.50)');
    expect(formatCost(0.51, 100)).toBe('約 51 円($0.51)');
    expect(formatCost(12.345, 150)).toBe('約 1,852 円($12.35)');
    expect(formatCost(1234.5, 150)).toBe('約 185,175 円($1,234.50)');
  });

  it('can omit the approximation mark', () => {
    expect(formatCost(0.5, 150, { approx: false })).toBe('75 円($0.50)');
  });

  it('handles zero, invalid and tiny amounts', () => {
    expect(formatCost(0, 150)).toBe('0 円($0.00)');
    expect(formatCost(Number.NaN, 150)).toBe('0 円($0.00)');
    expect(formatCost(-1, 150)).toBe('0 円($0.00)');
    expect(formatCost(0.004, 150)).toBe('1 円未満($0.01 未満)');
    expect(formatCost(0.008, 150)).toBe('約 1 円($0.01 未満)');
  });

  it('falls back to the default rate when the saved rate is invalid', () => {
    expect(formatCost(1, Number.NaN)).toBe('約 150 円($1.00)');
    expect(formatCost(1, 0)).toBe('約 150 円($1.00)');
  });

  it('formats the exchange rate', () => {
    expect(formatJpyPerUsd(150)).toBe('1 ドル = 150 円');
    expect(formatJpyPerUsd(147.5)).toBe('1 ドル = 147.5 円');
  });
});
