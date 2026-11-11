# Lower collections no longer raise Z-EM (November 2026)

## Problem

At f169c38, a lower customer collection rate could raise Z-EM, so an SOE whose customers paid less looked healthier. Two mechanisms in `shocks.run_scenario` / `engine.js runScenario` caused it:

1. **A surplus left current assets.** After repaying arrears and short-term debt, a surplus rebuilt the cash drawn in earlier years and no more. The rest was added to total assets but not to current assets, so a profitable SOE's working capital (X1) did not improve. When customers paid late, the same surplus funded the arrears, which *were* current assets. Lower collections therefore raised X1.
2. **Customer arrears counted at full value.** Unpaid bills were a current asset with no loss allowance and no write-off. When the cash gap was borrowed long-term, a receivable funded by long-term debt raised X1. Because Z's ratios are divided by total assets, the extra asset also diluted the negative ratios.

`docs/CHANGES-waterfall-v2.md` already noted the second effect ("Z-EM 2026 rises a little … because the customer arrears are current assets").

## Change

- **Surplus held as cash.** A surplus left after the repayments is added to Cash and current assets. It still rebuilds `CashDrawn` first. `legacy_loss_assets=True` keeps the old rule. Without a cash column, Cash starts at 0 and holds only the surpluses.
- **Loss allowance on customer arrears.** New setting `customer_arrears_provision_share`, default **100%**. That share of each year's new unpaid bills is a loss when billed. It is booked below EBIT, as `comp_provision_share` is for the State receivable. What is later collected of the provided part (`customer_arrears_collected`) is released as income. `Customer Arrears` stays the gross amount customers owe. The new stock `Customer Arrears Allowance` holds the provided part, and only gross less allowance is an asset. The new flow `Customer Arrears Provision` is the year's net charge. Cash, debt and interest paths are unchanged, because the allowance is not cash. Set the share to 0% to restore the full-value receivable.
- The setting is in `config.DEFAULT_CASH_SETTINGS`, in `PARAMETER_REGISTER`, under Advanced › Tariffs & collections (`templates/app.js`), and on the classic Streamlit page. The UI text that described arrears as full-value current assets is updated.
- Without a cash column, or with `cash_buffer_share` at 0, the held cash builds up but is never drawn, because the draw rule is unchanged.

## Expected side effect

Profitable SOEs now build up cash, so their baseline Z-EM rises even without a shock. This is consistent with the engine's existing assumption that capex equals depreciation. Loss-making SOEs are unaffected.

## Tests

- New: `tests/check_collections_sign.py`. Toy SOE, cases A (profit), B (loss borrowed long-term) and D (loss borrowed short-term). 10% and 30% of bills unpaid, arrears collected 0 / 0.5 / 1, horizons 1 and 3, both engines. Z with unpaid bills must be at or below Z with full collection in every year, and TA = TL + equity must hold.
- `check_engine_parity.py`: two scenarios added (partial allowance, no allowance), and the two new outputs are compared.
- Expectations changed because the surplus is now cash:
  - `check_cash_channel.py` test 2: current assets now exceed the original formula by the cash built up.
  - `check_fuel_path_cash.py` test 6: cash keeps rising after the drawdown is rebuilt (170, 190), and starts at 0 and holds the surpluses when no cash is reported. Test 2, the bit-exact comparison with 064ac24 (run with `SOE_BASELINE_REPO`): current assets may exceed 064ac24 by the extra cash, and the columns computed from them are skipped in those years. In the Monte Carlo part, Z-EM must be at or above 064ac24 and EFC at or below it wherever cash has built up.
  - `check_waterfall_v2.py` test 11: the old arrears checks now pin the allowance at 0%, the current-assets check nets out the profit that no longer reaches cash, and new checks cover the 100% default.
