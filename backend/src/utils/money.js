export const toCents = (decimal) => {
  const rounded = Math.round(Number(decimal) * 100);
  if (!Number.isFinite(rounded) || String(decimal).trim() === '') return NaN;
  return rounded;
};

export const fromCents = (cents) => (cents / 100).toFixed(2);

export const MIN_AMOUNT_CENTS = 0;