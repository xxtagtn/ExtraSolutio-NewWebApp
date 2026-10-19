import test from 'node:test';
import assert from 'node:assert/strict';
import { clientBillingAdjustment, clientPaymentTax, clientPaymentTotal } from './clientPaymentTotal.js';
import { paymentFinancialSnapshot } from './clientPaymentAdjustment.js';
import { clientPaymentSummary } from './clientPayment.js';
import { clientReceiptTaxSummary, receiptFiscal } from './clientReceiptTax.js';
import { buildClientFinanceSnapshot } from './clientFinanceSnapshot.js';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';

const event = (patch = {}) => ({ id: 1, date: '2026-08-16', status: 'finalized', totalRevenue: 3130.35, taxAmount: 585.35,
  billingAdjustment: 5, staffVatRateSnapshot: 23, vatRateSnapshot: 23, paidAmount: 0, signaledAmount: 0,
  billingStatus: 'pending', client: { id: 1, billingMethod: 'monthly', paymentTerm: 'days_15' }, ...patch });

test('FIC regression: 2545 + 5 net produces 2550 base, 586.50 VAT and 3136.50 due everywhere', () => {
  const source = event(), before = structuredClone(source);
  assert.deepEqual(clientBillingAdjustment(source), { base: 5, rate: 23, tax: 1.15, total: 6.15 });
  assert.equal(clientPaymentTotal(source), 3136.5);
  assert.equal(clientPaymentTax(source), 586.5);
  const fiscal = paymentFinancialSnapshot(source);
  assert.equal(fiscal.base, 2550); assert.equal(fiscal.tax, 586.5); assert.equal(fiscal.total, 3136.5);
  assert.deepEqual(fiscal.components.find(row => row.key === 'billing-adjustment'), {
    key: 'billing-adjustment', label: 'Ajuste de faturação', rate: '23', base: 5, tax: 1.15,
  });
  assert.equal(receiptFiscal(fiscal, 123).tax, 23);
  assert.deepEqual(clientReceiptTaxSummary(source, 0).outstanding, { base: 2550, tax: 586.5, total: 3136.5 });
  const finance = buildClientFinanceSnapshot(source);
  assert.equal(finance.periods[0].tax, 586.5); assert.equal(finance.periods[0].total, 3136.5);
  assert.equal(finance.payment.outstanding, 3136.5);
  assert.equal(buildClientFinancialSummary({ events: [source], period: '2026-08' })[0].total, 3136.5);
  assert.deepEqual(source, before);
  assert.equal(clientPaymentTotal(JSON.parse(JSON.stringify(source))), 3136.5);
});

test('adjustments inherit the Staff setting, including explicit zero and legacy event fallback', () => {
  assert.equal(clientBillingAdjustment(event({ staffVatRateSnapshot: 0 })).tax, 0);
  assert.equal(clientPaymentTotal(event({ staffVatRateSnapshot: 0 })), 3135.35);
  assert.equal(clientBillingAdjustment(event({ staffVatRateSnapshot: null })).tax, 1.15);
  assert.equal(clientBillingAdjustment(event({ staffVatRateSnapshot: null, vatRateSnapshot: 0 })).tax, 0);
  assert.equal(clientBillingAdjustment(event({ staffVatRateSnapshot: 23, vatRateSnapshot: 0 })).tax, 1.15);
});

test('negative and cent adjustments round VAT once, without accumulating on successive reads', () => {
  for (const [base, tax] of [[5, 1.15], [-5, -1.15], [0.5, 0.12], [-0.5, -0.12], [0, 0]]) {
    const source = event({ billingAdjustment: base });
    for (let i = 0; i < 3; i++) assert.equal(clientBillingAdjustment(source).tax, tax);
    assert.equal(clientPaymentTax(source), Math.round((585.35 + tax) * 100) / 100);
  }
  const fiscal = paymentFinancialSnapshot(event({ totalRevenue: 0.25, taxAmount: 0.05, billingAdjustment: 0.04 }));
  assert.equal(fiscal.tax, 0.06);
  assert.ok(fiscal.components.length, 'Independent rounding of the adjustment must retain its fiscal components');
});

test('existing invoice protections exclude both the adjustment and its VAT', () => {
  for (const patch of [{ invoices: [{ status: 'issued' }] }, { invoice: { status: 'paid' } },
    { financial: { hasInvoice: true } }, { externalService: { settledByInvoice: true } }]) {
    assert.equal(clientPaymentTotal(event(patch)), 3130.35);
    assert.equal(clientPaymentTax(event(patch)), 585.35);
    assert.equal(clientBillingAdjustment(event(patch)).base, 0);
  }
  assert.equal(clientPaymentTotal(event({ invoices: [{ status: 'void' }] })), 3136.5);
});

test('recorded cash and historical fiscal snapshots stay unchanged when an adjustment gains VAT', () => {
  const record = { version: 1, entries: [{ id: 'paid', type: 'remaining', amount: 3130.35, fiscal: { base: 2545, tax: 585.35, total: 3130.35 } }] };
  const source = event({ billingStatus: 'paid', paidAmount: 3130.35, clientPaymentRecord: record });
  const before = structuredClone(source);
  assert.equal(clientPaymentSummary(source).received, 3130.35);
  assert.equal(clientPaymentSummary(source).outstanding, 6.15);
  assert.deepEqual(clientReceiptTaxSummary(source, 3130.35).outstanding, { base: 5, tax: 1.15, total: 6.15 });
  assert.equal(buildClientFinanceSnapshot(source).archive.archived, false);
  assert.deepEqual(source, before);
  const legacy = clientPaymentSummary(event({ billingStatus: 'paid' }));
  assert.equal(legacy.received, 3135.35, 'Do not invent the extra 1.15 as an implicit legacy receipt');
  assert.equal(legacy.outstanding, 1.15);
});

test('cross-period adjustments require explicit allocation including the additional VAT', () => {
  const source = event({ date: '2026-08-31', endDate: '2026-09-01', isContinuous: true });
  const finance = buildClientFinanceSnapshot(source);
  assert.equal(finance.allocationRequired, true);
  assert.equal(finance.unassignedTotal, 3136.5);
  assert.equal(finance.unassignedTax, 586.5);
  assert.ok(finance.periods.every(row => row.tax === null && row.total === null));
});
