// Manual verification: hits the REAL Frankfurter API once.
// Run:  node scripts/smoke-fx.js
// Tests never touch the network; this script documents the live contract.
process.env.NODE_TEST = '0';
const { configureFx, fetchRate, convert } = await import('../src/services/fx.service.js');

configureFx(); // real global fetch

console.log('Fetching live EUR->USD rate from Frankfurter...');
const rate = await fetchRate('USD', { retries: 1, timeoutMs: 5000 });
console.log(`EUR/USD = ${rate.rate} (fetchedAt: ${rate.fetchedAt}, stale: ${rate.stale})`);

const sample = await convert({ amountCents: 15000, currency: 'USD' });
console.log(`150.00 EUR = ${sample.convertedAmount} USD`);

process.exit(0);