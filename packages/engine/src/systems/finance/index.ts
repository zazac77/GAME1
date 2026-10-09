import type { TurnContext } from '../../core/context';
import { isOperating, operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import { currentSpread } from './credit';
import { buybackPrice, ipoTerms, issuePrice } from './equity';

/**
 * Step 3: new term loans and voluntary repayments, then the equity
 * transactions, at the start of the quarter (validation already bounded
 * them all): dividends, share issues, buybacks and public offerings.
 */
export const financePreSystem: System = {
  id: 'financePre',
  run(ctx) {
    const { draft, config, turn } = ctx;
    for (const company of operatingCompanies(draft)) {
      const fin = ctx.decisions[company.id]?.finance;
      if (!fin) continue;
      const ledger = ctx.ledger(company.id);
      if (fin.borrow && fin.borrow > 0) {
        company.loans.push({
          id: newId(draft.meta, 'loan'),
          kind: 'term',
          principal: fin.borrow,
          spread: currentSpread(config, company),
          maturity: turn + config.finance.loanTermQuarters,
        });
        ledger.borrowed += fin.borrow;
      }
      let toRepay = fin.repay ?? 0;
      // Most expensive term loans first.
      const terms = company.loans
        .filter((l) => l.kind === 'term')
        .sort((a, b) => b.spread - a.spread || a.id.localeCompare(b.id));
      for (const loan of terms) {
        if (toRepay <= 0) break;
        const paid = Math.min(loan.principal, toRepay);
        loan.principal -= paid;
        toRepay -= paid;
        ledger.repaid += paid;
      }
      company.loans = company.loans.filter((l) => l.principal > 1e-6);
      equityTransactions(ctx, company);
    }
  },
};

/**
 * Dividends (paid pro rata to the registry; companies book what they receive,
 * actors and the public take it out of the simulation; the price drops by
 * the dividend per share), share issue (new shares to the public, the price
 * moves to the weighted average with the issue price), buyback (shares
 * bought from the public and cancelled), public offering (new shares to
 * the public, a quote at the offering price).
 */
function equityTransactions(ctx: TurnContext, company: Company): void {
  const { draft, config } = ctx;
  const fin = ctx.decisions[company.id]?.finance;
  if (!fin) return;
  const SM = config.stockMarket;
  const ledger = ctx.ledger(company.id);
  const register = (draft.stock.registry[company.id] ??= {});
  const quote = draft.stock.quotes[company.id];
  const N = company.sharesOutstanding;

  if (fin.dividend && fin.dividend > 0 && N > 0) {
    ledger.dividendsPaid += fin.dividend;
    for (const holderId of Object.keys(register).sort()) {
      const holder = draft.companies[holderId];
      const amount = (fin.dividend * (register[holderId] ?? 0)) / N;
      if (holder && amount > 0 && isOperating(holder)) {
        ctx.ledger(holderId).dividendsReceived += amount;
      }
    }
    if (quote) {
      const perShare = fin.dividend / N;
      quote.price = Math.max(SM.minPrice, quote.price - perShare);
      quote.referencePrice = Math.max(SM.minPrice, quote.referencePrice - perShare);
    }
    ctx.log({
      kind: 'dividend_paid',
      severity: 'info',
      companyId: company.id,
      data: { amount: fin.dividend, perShare: fin.dividend / N },
    });
  }

  if (fin.issueShares && fin.issueShares > 0 && quote) {
    const n = fin.issueShares;
    const price = issuePrice(draft, company);
    ledger.equityIssued += n * price * (1 - SM.capital.issueFeeShare);
    register.public = (register.public ?? 0) + n;
    company.sharesOutstanding += n;
    const blend = (p: number) => Math.max(SM.minPrice, (N * p + n * price) / (N + n));
    quote.price = blend(quote.price);
    quote.referencePrice = blend(quote.referencePrice);
    ctx.log({
      kind: 'shares_issued',
      severity: 'info',
      companyId: company.id,
      data: { shares: n, price },
    });
  } else if (fin.buyback && fin.buyback > 0 && quote) {
    const n = Math.min(fin.buyback, register.public ?? 0);
    const price = buybackPrice(draft, company);
    if (n > 0 && n < N) {
      ledger.buybacks += n * price;
      register.public = (register.public ?? 0) - n;
      company.sharesOutstanding -= n;
      const blend = (p: number) => Math.max(SM.minPrice, (N * p - n * price) / (N - n));
      quote.price = blend(quote.price);
      quote.referencePrice = blend(quote.referencePrice);
      ctx.log({
        kind: 'shares_bought_back',
        severity: 'info',
        companyId: company.id,
        data: { shares: n, price },
      });
    }
  }

  if (fin.ipo) {
    const terms = ipoTerms(draft, company);
    if (!terms) return;
    ledger.equityIssued += terms.proceeds;
    register.public = (register.public ?? 0) + terms.newShares;
    company.sharesOutstanding += terms.newShares;
    company.listed = true;
    const price = terms.pricePerShare;
    draft.stock.quotes[company.id] = {
      price,
      referencePrice: price,
      fundamental: price,
      history: [price],
      consensus: 0,
      publishedQuarter: -1,
    };
    ctx.log({
      kind: 'ipo',
      severity: 'info',
      companyId: company.id,
      data: { shares: terms.newShares, price },
    });
  }
}
