# AlphaStock Autonomous Research Report

Generated: 2026-05-27T12:42:21.207Z

This report is decision support, not a return guarantee. The engine explicitly penalizes overfitting, concentration, turnover, crash failure, and synthetic proxy dependence.

## Champion

- Model: crash_survival_rotation
- Status: accepted
- Composite score: 0.437
- CAGR: 4.7%
- Max drawdown: -15.9%
- Sharpe: 0.65
- Sortino: 0.76
- Calmar: 0.30
- Avg annual turnover: 2.57x
- Total modeled trading cost drag: 52.6%
- Tax drag proxy: 5.5%
- Semiconductor exposure: 4.4%

## Execution Assumptions

- Broker model: Korea Investment Securities US online base case
- US online commission: buy 0.3%, sell 0.3%
- US SEC fee on sells: 0.0%
- Slippage assumption: 0.1% per side
- Tax proxy: 22.0% on realized annual gains above a 2.5% proxy of KRW 100m capital, representing KRW 2.5m basic deduction.

## Accepted And Rejected Variants

| Model | Status | Score | CAGR | MDD | Turnover | Semi | W-F pass | Stress | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline_report_rebuild | rejected | 0.297 | 6.0% | -37.8% | 2.40x | 18.8% | 76.2% | 0.91 | calmar_too_low |
| dynamic_robust_hybrid | accepted | 0.357 | 6.0% | -32.0% | 2.60x | 11.0% | 85.7% | 0.96 | passed |
| cost_aware_universal_rotation | accepted | 0.373 | 5.6% | -25.8% | 2.60x | 9.5% | 85.7% | 0.96 | passed |
| dynamic_low_vol_trend | accepted | 0.374 | 5.7% | -26.0% | 2.59x | 8.7% | 81.0% | 0.96 | passed |
| dynamic_growth_offense | rejected | 0.307 | 6.7% | -31.7% | 2.48x | 13.3% | 81.0% | 0.92 | composite_score_below_champion_tolerance |
| crash_survival_rotation | champion | 0.437 | 4.7% | -15.9% | 2.57x | 4.4% | 90.5% | 0.98 | passed |

## Regime Performance

| Regime | CAGR | MDD | Worst month | Win rate |
| --- | ---: | ---: | ---: | ---: |
| dot_com_crash | 0.8% | -5.3% | -1.9% | 6.7% |
| post_crash_recovery | 10.0% | -6.0% | -2.3% | 62.1% |
| global_financial_crisis | -1.8% | -15.9% | -5.7% | 46.2% |
| qe_bull_market | 4.0% | -11.9% | -5.3% | 56.3% |
| q4_2018_drawdown | -21.1% | -9.5% | -7.2% | 66.7% |
| covid_crash_rebound | 0.0% | -8.4% | -5.3% | 50.0% |
| inflation_rate_shock | -3.5% | -7.1% | -4.3% | 70.0% |
| ai_semiconductor_cycle | 11.6% | -6.6% | -4.6% | 65.9% |

## Benchmarks

| Benchmark | CAGR | MDD | Sharpe | Calmar |
| --- | ---: | ---: | ---: | ---: |
| QQQ | 11.0% | -83.0% | 0.41 | 0.13 |
| SPY | 8.6% | -55.2% | 0.44 | 0.16 |
| QLD_or_SYN_QLD | 25.9% | -83.1% | 0.59 | 0.31 |
| TQQQ_or_SYN_TQQQ | 44.4% | -81.7% | 0.73 | 0.54 |
| SPY_IEF_60_40 | 7.0% | -31.4% | 0.63 | 0.22 |
| QQQ_BIL_trend | 8.2% | -58.3% | 0.49 | 0.14 |

## Current Advisory

- Date: 2026-05-26
- Risk state: risk_on
- Next rebalance date: 2026-06-01
- Emergency review threshold: portfolio -4% from month start or QQQ 50d + MFI/MACD deterioration

| Asset | Target weight | Reason |
| --- | ---: | --- |
| SOXL | 8.0% | strong relative momentum; leveraged sleeve capped; regime=risk_on |
| MU | 0.8% | strong relative momentum; regime=risk_on |
| INTC | 0.7% | strong relative momentum; regime=risk_on |
| AMD | 0.7% | strong relative momentum; regime=risk_on |
| CSCO | 0.7% | strong relative momentum; regime=risk_on |
| SOXX | 0.7% | strong relative momentum; regime=risk_on |
| UUP | 30.0% | regime=risk_on |
| SMH | 0.7% | regime=risk_on |
| BIL | 57.9% | risk buffer; regime=risk_on |

## Why this may fail in the future

- Free data sources may be incomplete, revised, delayed, or unavailable.
- Delisted assets are not fully represented, so survivorship-bias penalties are applied but cannot fully remove the limitation.
- Synthetic leveraged proxies are estimates and can understate real financing, tracking, liquidity, and path-dependent decay.
- Future regimes may differ from dot-com, 2008, COVID, 2022, or the AI/semiconductor cycle.
- Tax drag, borrow constraints, order-book liquidity, and personal account restrictions are approximated, not guaranteed.
- The advisory engine outputs target weights and reason codes only. It does not place brokerage orders.

