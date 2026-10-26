"""
All tunable numbers for the SOE Fiscal Risk Tool live here — coefficients,
thresholds, theme, chart layout. Change values here; page code shouldn't
need touching for recalibration.
"""

# ---------------------------------------------------------------------------
# Altman Z''-EM (Emerging Market) coefficients
# Z_EM = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4 + 3.25
# ---------------------------------------------------------------------------
ZEM_COEFFICIENTS = {"X1": 6.56, "X2": 3.26, "X3": 6.72, "X4": 1.05}
# No constant: this tool uses the Z'' (Eidelman) convention — the rating
# table and 1.1/2.6 zone cutoffs below are calibrated to the constant-free
# score, not Altman's Z''-EM (+3.25) variant from the shock-framework PDF.
# Mixing the two systematically inflated every score by 3.25.
ZEM_CONSTANT = 0.0

ZEM_LABELS = {
    "X1": "Working Capital / Total Assets",
    "X2": "Retained Earnings / Total Assets",
    "X3": "EBIT / Total Assets",
    "X4": "Book Equity / Total Liabilities",
}

ZEM_DESCRIPTORS = {
    "X1": {
        "strong_positive": "strong working capital position",
        "weak_positive": "modest working capital buffer",
        "negative": "working capital strain (current liabilities exceed current assets)",
    },
    "X2": {
        "strong_positive": "a solid retained earnings base",
        "weak_positive": "a thin retained earnings base",
        "negative": "accumulated losses eroding retained earnings",
    },
    "X3": {
        "strong_positive": "strong operating profitability",
        "weak_positive": "thin operating margins",
        "negative": "operating losses",
    },
    "X4": {
        "strong_positive": "a well-capitalised equity position",
        "weak_positive": "a modest but positive equity buffer",
        "negative": "a negative net worth position (liabilities exceed equity)",
    },
}
ZEM_COMPONENT_STRONG_THRESHOLD = {"X1": 0.15, "X2": 0.05, "X3": 0.05, "X4": 0.20}
SINGLE_DRIVER_SHARE_THRESHOLD = 0.60

ZONES = [
    ("Distress", float("-inf"), 1.1),
    ("Grey", 1.1, 2.6),
    ("Safe", 2.6, float("inf")),
]
Z_DISTRESS_CUTOFF = 1.1
Z_SAFE_CUTOFF = 2.6

# Indicative credit-rating cohort mapping for the Z-EM score, for reference
# only (Z''-Score range -> rating -> 1-yr PD), per the uploaded rating table.
Z_RATING_TABLE = [
    (4.90, float("inf"), "AAA", 0.0002),
    (4.35, 4.90, "AA+", 0.0003),
    (4.05, 4.35, "AA", 0.0004),
    (3.75, 4.05, "AA-", 0.0005),
    (3.60, 3.75, "A+", 0.0007),
    (3.40, 3.60, "A", 0.0008),
    (3.15, 3.40, "A-", 0.0010),
    (3.00, 3.15, "BBB+", 0.0020),
    (2.60, 3.00, "BBB", 0.0025),
    (2.40, 2.60, "BBB-", 0.0032),
    (2.00, 2.40, "BB+", 0.0075),
    (1.70, 2.00, "BB", 0.0100),
    (1.50, 1.70, "BB-", 0.0127),
    (1.25, 1.50, "B+", 0.0147),
    (0.90, 1.25, "B", 0.0207),
    (0.50, 0.90, "B-", 0.0710),
    (-0.05, 0.50, "CCC+", 0.1627),
    (-0.75, -0.05, "CCC", 0.1627),
    (-1.50, -0.75, "CCC-", 0.2000),
    (float("-inf"), -1.50, "D", 0.4000),
]


def z_rating(z):
    """Indicative rating cohort for a Z-EM score, from Z_RATING_TABLE."""
    if z != z:  # NaN
        return "—"
    for lo, hi, rating, _pd in Z_RATING_TABLE:
        if lo < z <= hi or (lo == float("-inf") and z <= hi):
            return rating
    return "—"


# ---------------------------------------------------------------------------
# Probability of Distress
#
# PD_BY_ZONE (3-bucket, from SOE_shock_framework.pdf Section 10) is kept
# only as a coarse fallback for a missing/unrecognized rating. The primary
# calibration is PD_BY_RATING below — the 1-yr PD column from the Z-EM
# rating cohort table (20 rating bands, AAA...D), already embedded in
# Z_RATING_TABLE above but previously unused past the rating letter itself.
# This gives real differentiation within a zone: e.g. a Distress-zone SOE
# rated 'B' (PD 2.07%) is not the same risk as one rated 'D' (PD 40.00%) —
# the old flat 72% for every Distress-zone SOE collapsed that distinction.
# ---------------------------------------------------------------------------
PD_BY_ZONE = {"Distress": 0.72, "Grey": 0.35, "Safe": 0.05}  # coarse fallback only

PD_BY_RATING = {rating: pd for (_lo, _hi, rating, pd) in Z_RATING_TABLE}


def pd_by_rating(rating: str) -> float:
    """Per-rating 1-yr PD from the uploaded rating cohort table. Falls back
    to PD_BY_ZONE via classify_zone(rating's midpoint) only if the rating
    string isn't recognized."""
    if rating in PD_BY_RATING:
        return PD_BY_RATING[rating]
    return float("nan")


def worst_pd_in_zone(zone: str) -> float:
    """The highest 1-yr PD among all rating bands whose Z-score range
    overlaps the given zone (Safe/Grey/Distress) — used as a 'maximum PD'
    reference for the same zone the SOE currently sits in, pending a
    dedicated max-PD table. A rating band straddling a zone boundary (e.g.
    'B', which spans both Distress and Grey) counts toward both zones,
    which is the conservative choice."""
    zone_bounds = {name: (lo, hi) for name, lo, hi in ZONES}
    if zone not in zone_bounds:
        return float("nan")
    lower, upper = zone_bounds[zone]
    candidates = [pd for (r_lo, r_hi, _rating, pd) in Z_RATING_TABLE if r_hi > lower and r_lo < upper]
    return max(candidates) if candidates else float("nan")


LGD_SLIDER_MIN = 1
LGD_SLIDER_MAX = 100
LGD_SLIDER_DEFAULT = 70

# ---------------------------------------------------------------------------
# Government LGD, by sector — sourced from GEMs (Global Emerging Markets Risk
# Database) "Default and Recovery Statistics: Public Lending 1994-2024"
# (EIB/IFC consortium, Table 26, recovery rates by GICS sector).
#
# GEMs measures the LENDER's recovery rate (RR) on public-counterparty
# loans. GEMs states explicitly that these recovery rates are high "because
# of the implicit state guarantees that these borrowers often benefit
# from" — the lender recovers a lot precisely BECAUSE the government steps
# in as guarantor of last resort. That support is the same money on both
# sides of the transaction: what the lender recovers IS what the
# government paid out to make the lender whole. So lender RR = government
# LGD directly (NOT 1 - RR) — a high lender recovery rate means the
# government absorbed a lot, i.e. a high government LGD. Flagged as a
# working assumption (lender RR as a proxy for government LGD), not an
# established fact, pending a direct source.
#
# Sector mapping (GEMs' raw GICS sector -> this tool's sector categories):
#   Transport, Industry   -> GICS "Industrials" (airlines/rail/road sit here)
#   Power / Utilities     -> GICS "Utilities"
#   Telecoms              -> GICS "Communication services"
#   Other                 -> GICS "Others" (direct match)
#   Energy, Agriculture   -> GEMs' Energy and Consumer staples rows are
#                            undisclosed (below GEMs' own 10-contract
#                            minimum) -> fall back to the "Overall" row,
#                            per the fallback rule agreed for this build.
#
# Decision rule: a disclosed sector, however thin its sample (e.g.
# Communication services and Materials both have only 11 defaulted
# contracts), is kept as reported — no shrinkage. Only an undisclosed
# (blank) sector falls back to Overall.
# ---------------------------------------------------------------------------
SECTOR_RECOVERY_DATA = {
    "Transport": {"average": 0.933, "p10": 0.813, "p25": 0.960, "p90": 1.000, "n_defaults": 49, "gems_source": "Industrials"},
    "Energy": {"average": 0.858, "p10": 0.521, "p25": 0.853, "p90": 1.000, "n_defaults": 308, "gems_source": "Overall (Energy undisclosed by GEMs)"},
    "Power / Utilities": {"average": 0.878, "p10": 0.523, "p25": 0.912, "p90": 1.000, "n_defaults": 92, "gems_source": "Utilities"},
    "Agriculture": {"average": 0.858, "p10": 0.521, "p25": 0.853, "p90": 1.000, "n_defaults": 308, "gems_source": "Overall (Consumer staples undisclosed by GEMs)"},
    "Industry": {"average": 0.933, "p10": 0.813, "p25": 0.960, "p90": 1.000, "n_defaults": 49, "gems_source": "Industrials"},
    "Telecoms": {"average": 0.799, "p10": 0.374, "p25": 0.645, "p90": 1.000, "n_defaults": 11, "gems_source": "Communication services"},
    "Other": {"average": 0.824, "p10": 0.515, "p25": 0.742, "p90": 1.000, "n_defaults": 111, "gems_source": "Others"},
}

# Derived display range per sector: (low government LGD, high government
# LGD) = (p10 RR, p90 RR) directly — since RR = LGD here, not 1-RR. Single
# source of truth is SECTOR_RECOVERY_DATA above; this is computed from it,
# not maintained separately.
SECTOR_LGD_REFERENCE = {
    sector: (round(d["p10"], 4), round(d["p90"], 4))
    for sector, d in SECTOR_RECOVERY_DATA.items()
}
EAD_METHOD = "total_liabilities"

# ---------------------------------------------------------------------------
# KPI specs — formula inputs (`requires`, our raw column names), direction,
# red/amber/green cuts (illustrative IMF SOE Health Check Tool-style
# starting points, pending recalibration), and the description shown under
# each chart. `requires` names are checked against the ingested DataFrame's
# raw columns (before ratio computation) to decide if a KPI is available.
# ---------------------------------------------------------------------------
KPI_THRESHOLDS = {
    "operating_margin": {
        "label": "Operating margin", "unit": "%", "direction": "higher_is_better",
        "red_cut": 0.0, "green_cut": 0.10,
        "requires": ["Operating Profits (EBIT)", "Revenues"],
        "description": "EBIT as a share of revenue. Negative means operating losses before financing costs.",
    },
    "cost_recovery": {
        "label": "Cost recovery", "unit": "x", "direction": "higher_is_better",
        "red_cut": 1.0, "green_cut": 1.10,
        "requires": ["Revenues", "Government Grants", "Cost of Goods Sold", "Other Operating Expenses"],
        "description": "(Total revenue − government grants) / (COGS + other operating expenses). The numerator assumes reported grants are included in total revenue and are removed only once. All four components must be reported; investment grants and equity injections are not deducted. Values below 1x indicate incomplete coverage of these operating costs without grants. Cutoffs (alert <1.0x, good ≥1.1x) are illustrative.",
    },
    "net_margin": {
        "label": "Net margin", "unit": "%", "direction": "higher_is_better",
        "red_cut": 0.0, "green_cut": 0.05,
        "requires": ["Net Income", "Revenues"],
        "description": "Bottom-line profit as a share of revenue, after interest and tax.",
    },
    "ebitda_margin": {
        "label": "EBITDA margin", "unit": "%", "direction": "higher_is_better",
        "red_cut": 0.0, "green_cut": 0.15,
        "requires": ["EBITDA", "Revenues"],
        "description": "Cash operating profitability before depreciation, interest, and tax.",
    },
    "roa": {
        "label": "Return on assets", "unit": "%", "direction": "higher_is_better",
        "red_cut": 0.0, "green_cut": 0.03,
        "requires": ["Net Income", "Total Assets"],
        "description": "Net income relative to the asset base — how efficiently assets generate profit.",
    },
    "roe": {
        "label": "Return on equity", "unit": "%", "direction": "higher_is_better",
        "red_cut": 0.0, "green_cut": 0.10,
        "requires": ["Net Income", "Equity"],
        "description": "Net income relative to equity. Suppressed when equity is negative — the ratio's sign flips and no longer means what it normally means.",
    },
    "current_ratio": {
        "label": "Current ratio", "unit": "x", "direction": "higher_is_better",
        "red_cut": 1.0, "green_cut": 1.5,
        "requires": ["Current Assets", "Current Liabilities"],
        "description": "Current assets divided by current liabilities. Below 1x signals a liquidity squeeze.",
    },
    "working_capital_ratio": {
        "label": "Working capital / assets", "unit": "%", "direction": "higher_is_better",
        "red_cut": -0.05, "green_cut": 0.05,
        "requires": ["Current Assets", "Current Liabilities", "Total Assets"],
        "description": "Net working capital as a share of total assets — this is Altman's X1 component.",
    },
    "debt_to_ebitda": {
        "label": "Debt / EBITDA", "unit": "x", "direction": "lower_is_better",
        "red_cut": 6.0, "green_cut": 4.0,
        "requires": ["Total Liabilities", "EBITDA"],
        "description": "Total liabilities relative to EBITDA — roughly, years of cash operating profit to repay debt. Suppressed when EBITDA is negative.",
    },
    "liabilities_to_assets": {
        "label": "Liabilities / assets", "unit": "%", "direction": "lower_is_better",
        "red_cut": 0.85, "green_cut": 0.65,
        "requires": ["Total Liabilities", "Total Assets"],
        "description": "Overall leverage — how much of the asset base is financed by liabilities rather than equity.",
    },
    "interest_coverage": {
        "label": "Interest coverage", "unit": "x", "direction": "higher_is_better",
        "red_cut": 1.0, "green_cut": 2.5,
        "requires": ["Operating Profits (EBIT)", "Interest Expense"],
        "description": "EBIT divided by interest expense. Below 1x means operating profit can't cover debt service.",
    },
    "debt_to_equity": {
        "label": "Debt / equity", "unit": "x", "direction": "lower_is_better",
        "red_cut": 3.0, "green_cut": 1.5,
        "requires": ["Total Liabilities", "Equity"],
        "description": "Total liabilities relative to equity. Suppressed when equity is negative.",
    },
    "asset_turnover": {
        "label": "Asset turnover", "unit": "x", "direction": "higher_is_better",
        "red_cut": 0.2, "green_cut": 0.6,
        "requires": ["Revenues", "Total Assets"],
        "description": "Revenue generated per unit of assets. Supplementary only — excluded from the Z-EM formula itself.",
    },
    "depreciation_to_ebitda": {
        "label": "Depreciation / EBITDA", "unit": "%", "direction": "lower_is_better",
        "red_cut": 0.60, "green_cut": 0.30,
        "requires": ["Depreciation", "EBITDA"],
        "description": "A proxy for capital intensity — how much of cash operating profit is absorbed by depreciation.",
    },
    "grants_to_revenue": {
        "label": "Grants / revenue", "unit": "%", "direction": "lower_is_better",
        "red_cut": 0.50, "green_cut": 0.25,
        "requires": ["Government Grants", "Revenues"],
        "description": "Government grants relative to revenue — a direct measure of fiscal dependency.",
    },
    "grants_to_expense": {
        "label": "Grants / total expense", "unit": "%", "direction": "lower_is_better",
        "red_cut": 0.40, "green_cut": 0.20,
        "requires": ["Government Grants", "Total Expense"],
        "description": "Government grants relative to total expense — how much of spending grants cover.",
    },
    "effective_tax_rate": {
        "label": "Effective tax rate", "unit": "%", "direction": "lower_is_better",
        "red_cut": 0.40, "green_cut": 0.25,
        "requires": ["Tax Expense", "Operating Profits (EBIT)"],
        "description": "Tax expense relative to EBIT. Only meaningful when EBIT is positive.",
    },
}

KPI_CATEGORIES = {
    "profitability": ["operating_margin", "cost_recovery", "net_margin", "roa", "roe"], #"ebitda_margin",
    "liquidity": ["current_ratio", "working_capital_ratio"],
    "solvency": ["debt_to_ebitda", "liabilities_to_assets", "interest_coverage", "debt_to_equity", "asset_turnover", "depreciation_to_ebitda"],
    "fiscal_dependency": ["grants_to_revenue", "grants_to_expense", "effective_tax_rate"],
}
CATEGORY_LABELS = {
    "profitability": "Profitability",
    "liquidity": "Liquidity",
    "solvency": "Solvency",
    "fiscal_dependency": "Fiscal dependency",
}
CATEGORY_ORDER = ["profitability", "liquidity", "solvency", "fiscal_dependency"]

# ---------------------------------------------------------------------------
# Shock module defaults — sector fuel cost shares from SOE_shock_framework.pdf
# (Section 4); remaining defaults are starting points pending calibration.
#
# Shock magnitudes follow the standard DSA/DSF convention: FX depreciation
# 30%, interest-rate shock 200bps. Sliders on the Shock Scenarios page also
# now permit negative values (favorable shocks — cheaper fuel, currency
# appreciation, rate cuts, arrears clearing), not just adverse ones.
# ---------------------------------------------------------------------------
SECTOR_FUEL_COST_SHARE = {
    "Transport": 0.38, "Energy": 0.25, "Power / Utilities": 0.25,
    "Agriculture": 0.20, "Industry": 0.15, "Telecoms": 0.15, "Other": 0.20,
}

# Sector fallback for revenue-growth volatility, used when an SOE has fewer
# than 3 years of data to compute its own historical volatility. Illustrative
# starting points pending calibration against a larger panel.
SECTOR_REVENUE_VOLATILITY = {
    "Transport": 0.15, "Energy": 0.10, "Power / Utilities": 0.10,
    "Agriculture": 0.20, "Industry": 0.12, "Telecoms": 0.08, "Other": 0.15,
}

DEFAULT_SHOCK_PARAMS = {
    "fuel_shock_pct": 0.25, "tariff_passthrough": 0.50, "fx_shock_pct": 0.30,
    "fx_cost_share": 0.20, "fx_revenue_share": 0.10, "fx_debt_share": 0.30,
    "floating_debt_share": 0.40, "rate_shock_bps": 200,
    "revenue_shock_std_devs": -1.0, "revenue_elasticity": 1.00,
    "arrears_pct_of_revenue": 0.05, "shock_duration_years": 2,
    "near_term_maturity_share": 0.20, "refinancing_spread_bps": 150,
    # Case C of the fuel transmission: share of the fuel-cost change (left after
    # any tariff increase) the government compensates. It never reaches the
    # SOE's EBIT; it is recognised as compensation owed by the State, and only
    # the in-year paid share arrives as cash (DEFAULT_CASH_SETTINGS). 0 = off.
    "fuel_subsidy_share": 0.0,
    # End-user tariff increase applied during the shock years, as a share of
    # revenue — a policy response, so it is a magnitude (0 in the no-shock
    # path). 0 = Option A (tariff freeze); 0.10–0.15 = Option B.
    "tariff_increase_pct": 0.0,
    # Per-year fuel price change for the fuel channel only (index 0 = projection
    # year 1; zero beyond its end), e.g. [0, 0.60, 0.30] = +60% in year 2, +30% in
    # year 3. Replaces the step (fuel_shock_pct for shock_duration_years); the
    # tariff increase then applies in the years where the path is non-zero.
    # Empty = step profile.
    "fuel_shock_path": [],
    # True restores the original rule in which a loss that is borrowed also
    # reduces total assets (the balance sheet then no longer balances). False
    # keeps TA = TL + Equity; it only changes years with negative net income.
    "legacy_loss_assets": False,
}

# Cash and financing settings for the shock engine (Shock Scenarios → "Cash &
# financing"). These defaults reproduce the original model — the State pays its
# compensation in full in the same year, and any cash shortfall is long-term
# debt with no interest, so current liabilities stay flat — with one exception:
# an SOE whose data report "Cash and Equivalents" pays a shortfall out of that
# cash first (cash_buffer_share = 1), and borrows only the rest. Set
# cash_buffer_share to 0 to borrow everything, as before.
DEFAULT_CASH_SETTINGS = {
    "comp_paid_share": 1.0,             # share of recognised State compensation paid in the same year
    "comp_backlog_collected": 1.0,      # share of the opening State receivable collected during the year
    "comp_provision_share": 0.0,        # share of unpaid compensation written off as a loss (0 = keep as receivable)
    "cash_gap_short_term_share": 0.0,   # share of the cash gap funded in current liabilities (rest long-term)
    "cash_gap_payables_share": 0.0,     # of the short-term part, share via unpaid supplier bills (no interest)
    "new_debt_interest_rate": 0.0,      # annual interest rate on the new bank and long-term debt
    "vat_rate": 0.18,                   # VAT rate applied to the extra fuel bill (Senegal standard rate)
    "vat_trapped_share": 0.0,           # share of that input VAT that cannot be offset or refunded
    "fuel_oil_linkage": 1.0,            # share of the fuel bill whose price moves with the oil shock (1 = all of it)
    "tariff_revenue_base": "revenue",   # base of the tariff increase: "revenue" or "revenue_ex_grants" (Revenue - Government Grants)
    "cash_buffer_share": 1.0,           # share of a cash shortfall paid from opening cash before borrowing (0 = borrow everything)
    "cash_floor_opex_share": 0.0,       # cash kept back, as a share of operating expense (not drawn)
    # Cash waterfall (off by default): a priority-of-payments rule. Each year's cash pays,
    # in order, (1) IPPs, (2) fuel, (3) debt service, (4) a reserve account, (5) the SOE's
    # own operations and other suppliers. It decides who is paid but creates no cash: a
    # shortfall is not borrowed but left unpaid from the bottom tier up.
    "waterfall_on": 0.0,                # 1 = waterfall in place (0/1)
    "waterfall_order": "senelec_note",  # order of payment: a key of WATERFALL_ORDERS ("custom" uses the rank_* settings)
    "shortfall_rule": "soe",            # who absorbs a shortfall: "soe" (its own operations first), "junior" (junior creditors
                                        # first), "pro_rata" (both together) or "state" (the State pays it)
    "ipp_cost_share": 0.0,              # IPP capacity and energy payments, share of operating expense
    "statutory_cost_share": 0.0,        # statutory charges, levies and operator / collection costs, share of operating expense (tier 0)
    "om_floor_share": 0.0,              # protected minimum for the SOE's own operations and maintenance, share of its own-cost bill
    "junior_share": 0.0,                # share of the residual own-cost bill owed to junior creditors (other suppliers, regulators, subsidies, capex)
    "reserve_months": 0.0,              # reserve account target: months of IPP payments and debt service
    # custom order (waterfall_order = "custom"): lower = paid first, equal = pari passu
    "rank_statutory": 0.0, "rank_fuel": 2.0, "rank_ipp": 1.0, "rank_debt": 3.0, "rank_reserve": 4.0,
    "rank_om_floor": 5.0, "rank_residual": 6.0,
    # how much cash goes through the waterfall: coverage x compliance, phased in over the ramp-up from the start year
    "waterfall_coverage": 1.0,          # share of collections that enter the account
    "waterfall_compliance": 1.0,        # share of that cash actually routed (60-100% in practice)
    "waterfall_start_year": 1.0,        # projection year the waterfall starts
    "waterfall_rampup_months": 0.0,     # linear phase-in (12-24 months in practice)
    # what being unpaid costs
    "late_rate_priority": 0.0,          # late-payment interest on arrears to IPPs and fuel suppliers (PPA penalty rate)
    "late_rate_debt": 0.0,              # default interest on missed debt service
    "late_rate_other": 0.0,             # late-payment interest on statutory, own-operations and junior arrears
    "default_on_missed_debt": 0.0,      # Off by default: an unpaid debt-service amount is not itself a realised default; optional single-scenario sensitivity
    # behaviour under the waterfall
    "priority_discount": 0.0,           # price cut on fuel and IPP bills that priority creditors grant in return
    "state_paid_uplift": 0.0,           # points added to the State's in-year payment shares once the waterfall runs
    # baseline: tariff gap, State compensation, collections, demand
    "cost_recovery_ratio": 0.0,         # customer revenue / full cost of supply (operating expense + interest); 0 = from the data
    "tariff_gap_state_share": 1.0,      # share of a change in the tariff gap that the State compensates (the rest is the SOE's)
    "receivable_current_share": 1.0,    # share of the State compensation receivable counted in current assets (X1)
    "collect_households": 1.0, "collect_large_private": 1.0, "collect_public": 1.0,   # in-year collection rates by segment
    "share_households": 0.55, "share_large_private": 0.30, "share_public": 0.15,     # segment shares of customer revenue (placeholders)
    "customer_arrears_collected": 0.5,  # share of unpaid customer bills collected the next year
    "demand_growth": 0.0,               # yearly growth of sales and cash operating costs
    "losses_change": 0.0,               # change in network losses, share of billed sales lost at the same cost
    # probability of distress on the Shock Scenarios page
    "pd_method": "rating",              # "rating" (band PD, max 40%), "rating_tail" (bands, then a logistic tail below the D threshold),
                                        # "logistic" (PD = 1 / (1 + exp(-(a + b Z))) everywhere) or "user" (a fixed annual PD)
    "pd_logit_a": -2.02276962,                # minimax reference-PD calibration, uncapped (illustrative; see docs/PD_CALIBRATION.md)
    "pd_logit_b": -0.89133626,                # minimax reference-PD calibration, uncapped (illustrative)
    "pd_user": 0.10,                    # annual PD when pd_method = "user"
    "pd_on_default": 1.0,               # PD in a year with debt service unpaid (1 = the default has happened; 0.40 = the D band)
    # Refinancing (separate assumption, off by default): short-term bank debt replaced
    # by long-term loans in the first projection year.
    "refinance_share": 0.0,             # share of short-term bank debt refinanced
    "short_term_debt_rate": 0.08,       # rate on the overdrafts that are refinanced (SENELEC note: 7.5–8.5%)
    "refinance_long_term_rate": 0.05,   # rate on the long-term loans that replace them (placeholder)
    "refinance_start_year": 1.0,        # projection year the refinancing happens (lenders take a year or more)
    "refinance_min_rating": "",         # refinanced only once the previous year's rating is at least this ("" = no condition)
    # Emergency government support: new borrowing stops where total liabilities /
    # total assets would pass this cap and the State injects the rest. 0 = no cap.
    "borrowing_cap_debt_to_assets": 0.0,
}

# Provenance of the logistic PD coefficients above (the Monte Carlo sensitivity; shown in the PD-model panel of the HTML tool).
# Reproduce with `python scripts/calibrate_pd.py`; old_a / old_b are the earlier capped fit (`--caps`).
PD_CALIBRATION_META = {
    "fit": "minimax_absolute_pd_deviation",
    "anchor_count": 20,
    "reference": "illustrative 20-level rating PD table",
    "objective": "minimize maximum absolute PD error (percentage points) at reference band representative Z-EM anchors",
    "status": "scenario calibration; not an empirically validated default forecast",
    "old_a": -2.18031828,
    "old_b": -1.1061396,
    "a": DEFAULT_CASH_SETTINGS["pd_logit_a"],
    "b": DEFAULT_CASH_SETTINGS["pd_logit_b"],
}

# "Cash waterfall" button on the Shock Scenarios page: switches the priority of
# payments on, on top of whatever scenario is set (refinancing stays as set).
WATERFALL_PRESET = {"waterfall_on": 1.0}

# Orders of payment. Ranks: lower = paid first, equal = pari passu (shared in
# proportion to the bills). "residual" is the rank of the SOE's own operations
# above the floor and of the junior creditors; the shortfall rule decides which
# of the two absorbs first (or both together). The reserve is drawn before the
# tiers at or above its rank go unpaid.
WATERFALL_TIERS = ["statutory", "ipp", "fuel", "debt", "reserve", "om_floor", "residual"]
WATERFALL_ORDERS = {
    "senelec_note": {"short": "IPPs first", "label": "Senegal: IPPs first (SENELEC note)",
                     "ranks": {"statutory": 0, "ipp": 1, "fuel": 2, "debt": 3, "reserve": 4, "om_floor": 5, "residual": 6},
                     "rule": "soe",
                     "evidence": "SENELEC oil-shock note (2026): IPPs paid first. Ranks of debt service and the reserve are assumptions."},
    "pari_passu": {"short": "IPPs and fuel pari passu", "label": "IPPs and fuel pari passu (suggested base)",
                   "ranks": {"statutory": 0, "ipp": 1, "fuel": 1, "debt": 2, "reserve": 3, "om_floor": 4, "residual": 5},
                   "rule": "soe",
                   "evidence": "Task team review (20 Oct 2026): IPPs and fuel form one top tier in Ghana and Côte d'Ivoire; a gas supplier can stop delivering."},
    "fuel_first": {"short": "fuel first", "label": "Fuel before IPPs (sensitivity)",
                   "ranks": {"statutory": 0, "ipp": 2, "fuel": 1, "debt": 3, "reserve": 4, "om_floor": 5, "residual": 6},
                   "rule": "soe",
                   "evidence": "Sensitivity on the order of payment (fuel before IPPs)."},
    "ghana": {"short": "Ghana order", "label": "Ghana: cash waterfall mechanism (2025)",
              "ranks": {"statutory": 0, "ipp": 1, "fuel": 1, "debt": 2, "reserve": 3, "om_floor": 2, "residual": 2},
              "rule": "pro_rata",
              "evidence": "PURC validation report, May 2025 (Cabinet approval 20 May 2025): Level A = IPPs, WAPCo and the Fuel Account; statutory "
                          "deductions; Level B = SOEs (VRA, Bui, GNGC, ECG, GRIDCo), regulators and embedded generators, each a set share of the pool. "
                          "Debt service and reserves are not mentioned; placed in Level B as an assumption."},
    "cote_divoire": {"short": "Côte d'Ivoire order", "label": "Côte d'Ivoire: operator first, then IPPs and gas",
                     "ranks": {"statutory": 0, "ipp": 1, "fuel": 1, "debt": 2, "reserve": 3, "om_floor": 4, "residual": 5},
                     "rule": "soe",
                     "evidence": "IPP payments are prioritised by law in a cascade (Proparco); the operator's (CIE) remuneration first and IPPs and gas "
                                 "pari passu are from the task team review and not independently verified. Put the operator fee in the statutory tier."},
    "custom": {"short": "custom order", "label": "Custom order",
               "ranks": None, "rule": None,
               "evidence": "Ranks set on the panel (rank_* settings)."},
}

# The four scenarios of the task team review, on the same baseline. The shock
# scenario also applies the oil price path (the page does that).
WATERFALL_SCENARIOS = {
    "status_quo": {"short": "No waterfall", "label": "No waterfall (status quo)", "set": {"waterfall_on": 0.0}},
    "full_recovery": {"short": "Full cost recovery, good compliance", "label": "Waterfall, full cost recovery, good compliance",
                      "set": {"waterfall_on": 1.0, "cost_recovery_ratio": 1.0, "waterfall_coverage": 1.0, "waterfall_compliance": 1.0}},
    "tariff_gap": {"short": "Tariff gap, partial compliance", "label": "Waterfall, persistent tariff gap, partial compliance",
                   "set": {"waterfall_on": 1.0, "cost_recovery_ratio": 0.85, "waterfall_coverage": 1.0, "waterfall_compliance": 0.6}},
    "shock": {"short": "Fuel price shock", "label": "Waterfall with a fuel price shock", "set": {"waterfall_on": 1.0}, "oil_shock": True},
}

# "Oil +60% with delayed State payment" preset on the Shock Scenarios page —
# the SENELEC assumptions (sources in PARAMETER_REGISTER below). The fuel price
# path (+60% in 2026, +30% in 2027 from a 2024 base year) is set by the preset
# button together with a horizon of at least 5 years; these are the exposure
# and cash settings it applies. fuel_shock_pct is the path's peak: it labels
# the button and centres the Monte Carlo draws (the engine reads the path).
OIL_SHOCK_PRESET = {
    "fuel_shock_pct": 0.60,
    "fuel_shock_path": [0.0, 0.60, 0.30, 0.0, 0.0],  # 2025–2029: +60% in 2026, half of it in 2027, then back
    "fuel_cost_share": 0.55,            # fuel purchases 494.9 bn / opex 888.5 bn (2022); IPP purchases excluded
    "fuel_oil_linkage": 0.9,            # HFO and diesel follow oil; coal (35.7 of 494.9 bn) does not
    "tariff_passthrough": 0.0,          # tariffs frozen (Option A)
    "fuel_subsidy_share": 1.0,          # the State compensates the whole RMA gap
    "comp_paid_share": 0.60,            # 2022: 333.2 bn recognised, 135.8 bn still owed at year-end
    "comp_backlog_collected": 1.0,      # the rest is collected the next year
    "comp_provision_share": 0.0,
    "cash_gap_short_term_share": 1.0,   # overdrafts, short-term loans, supplier credit
    "cash_gap_payables_share": 0.0,
    "new_debt_interest_rate": 0.033,    # interest 14.6 bn / borrowings 430.8 bn (2024)
    "ipp_cost_share": 0.17,             # purchased electricity ≈ (COGS 647.4 bn − fuel 494.9 bn) / opex 888.5 bn (2022); used only by the waterfall
    "vat_trapped_share": 0.0,
    "tariff_revenue_base": "revenue_ex_grants",  # 214.7 bn of RMA compensation sits inside revenue
}

# Exposure starting values when an SOE's data carry no exposure columns
# (placeholders — replace with SOE-specific values from notes to the accounts
# or an SOE questionnaire; see calculations.soe_exposures for the order in
# which observed / derived / default values are used).
DEFAULT_EXPOSURES = {
    "tariff_passthrough": 0.50, "fx_cost_share": 0.20, "fx_revenue_share": 0.10,
    "fx_debt_share": 0.30, "floating_debt_share": 0.40, "near_term_maturity_share": 0.20,
    "revenue_elasticity": 1.00, "fuel_subsidy_share": 0.0,
}

# Exposure at default: EAD = share × total liabilities (a proxy for the part
# of the balance sheet the government would stand behind), or observed
# government-guaranteed debt where the data carry it. 1.0 reproduces the
# original "EAD = total liabilities" assumption; 0.6 / 0.8 are the
# sensitivity cases discussed for SOEs without guarantee data.
EAD_SHARE_DEFAULT = 1.0
EAD_SHARE_PRESETS = [0.6, 0.8, 1.0]

# Monte Carlo: interest-rate and revenue shocks can be drawn too (standard
# deviations 0 = held at the slider value, as in the original tool). Pairwise
# correlations, keyed "a|b"; only fuel–FX is non-zero by default.
MC_DEFAULT_RATE_STD_BPS = 0.0
MC_DEFAULT_REVENUE_STD_SD = 0.0
MC_DEFAULT_CORRELATIONS = {
    "fuel|fx": 0.30, "fuel|rate": 0.0, "fuel|revenue": 0.0,
    "fx|rate": 0.0, "fx|revenue": 0.0, "rate|revenue": 0.0,
}
MC_DEFAULT_SIMULATIONS = 1000
MC_DEFAULT_FUEL_STD = 0.10
MC_DEFAULT_FX_STD = 0.08
MC_DEFAULT_CORRELATION = 0.30
MC_HORIZON_YEARS = 3
DEFAULT_GDP_GROWTH = 0.03

# ---------------------------------------------------------------------------
# Ingestion schema
# ---------------------------------------------------------------------------
REQUIRED_COLUMNS = [
    "Entity", "Year", "Sector", "Revenues", "Total Expense", "Operating Expense",
    "Operating Profits (EBIT)", "Net Income", "Current Assets", "Total Assets",
    "Current Liabilities", "Total Liabilities", "Equity", "Retained Earnings",
    "Interest Expense", "Tax Expense", "EBITDA", "Government Grants",
    "Depreciation", "Currency", "Units",
]
OPTIONAL_SHOCK_COLUMNS = [
    "Cash and Equivalents", "FX Revenue Share", "FX Cost Share", "FX Debt Share",
    "Floating Rate Debt Share", "Short Term Debt", "Government Arrears Owed",
    "Fuel Cost Share", "VAT Credits",
]

# ---------------------------------------------------------------------------
# Theme — World Bank navy title band / top nav, bright-blue accent, and
# good / watch / alert status colors. Matches the interactive HTML version
# (templates/app.css) so the Streamlit app and the HTML file read as one
# product. Keys are unchanged from the earlier palette, so page code that
# refers to e.g. THEME["chart_navy"] or THEME["gold"] keeps working.
# ---------------------------------------------------------------------------
FONT_SCALE = 1.2
BASE_ROOT_PX = 16


def fs(px):
    return f"{round(px * FONT_SCALE, 1)}px"


THEME = {
    # top nav / title band
    "sidebar_bg": "#002244", "sidebar_bg_active": "#0B3A66",
    "sidebar_text": "#C6D0DB", "sidebar_text_active": "#FFFFFF",
    # surfaces and text
    "bg": "#FFFFFF", "card": "#FFFFFF", "border": "#E1E6EC", "line": "#E1E6EC",
    "text": "#1C2530", "ink2": "#4C5A68", "muted": "#76828F", "heading": "#002244",
    # accent (World Bank bright blue) and its stronger text shade
    "blue": "#0071BC", "blue_bg": "#E5F5FB", "accent": "#009FDA",
    # "gold" is the highlight color in charts (latest-year bar, markers)
    "gold": "#009FDA", "gold_bg": "#E5F5FB",
    # status: good / watch / alert — *_ink is the readable text shade
    "green": "#00A996", "green_bg": "#E5F6F4", "green_ink": "#00796B",
    "amber": "#F7B841", "amber_bg": "#FEF1D9", "amber_ink": "#8A5D00",
    "red": "#D03B3B", "red_bg": "#FAEBEB", "red_ink": "#B12F2F",
    "purple": "#002244", "purple_bg": "#E6EAF0",
    "chart_navy": "#002244", "chart_navy_bg": "#E6EAF0",
    "chart_cyan": "#009FDA", "chart_cyan_bg": "#E5F5FB",
}

ZONE_COLORS = {"Safe": THEME["green"], "Grey": THEME["amber"], "Distress": THEME["red"]}
ZONE_STYLE = {
    "Distress": {"color": THEME["red"], "bg": THEME["red_bg"]},
    "Grey": {"color": THEME["amber"], "bg": THEME["amber_bg"]},
    "Safe": {"color": THEME["green"], "bg": THEME["green_bg"]},
}

CHART_HEIGHT = 230
CHART_LAYOUT = dict(
    height=CHART_HEIGHT,
    margin=dict(l=6, r=6, t=6, b=6),
    plot_bgcolor="rgba(0,0,0,0)",
    paper_bgcolor="rgba(0,0,0,0)",
    font=dict(family="Open Sans, Segoe UI, sans-serif", size=round(11 * FONT_SCALE, 1), color=THEME["text"]),
    bargap=0.45,
    bargroupgap=0.15,
    showlegend=False,
)
BAR_CORNER_RADIUS = 3
LINE_SHAPE = "linear"
LINE_SMOOTHING = 0.0
# Every line chart is drawn as a smooth curve through the data points: a cardinal
# spline (tension × the Catmull-Rom tangent, natural ends). 1.0 = Catmull-Rom,
# lower = tighter curve with less overshoot between points. Used by
# utils/charts.smooth_xy (Plotly pages) and templates/app.js (HTML version).
LINE_SMOOTH_TENSION = 0.75

# ---------------------------------------------------------------------------
# Plain-language definitions — used for hover tooltips (ⓘ icons) and the
# Home page glossary. Written for a reader with no finance background.
# ---------------------------------------------------------------------------
GLOSSARY = {
    "Z-EM score": "A single number summarizing an SOE's financial health from its balance sheet — the higher, the healthier. Built from four ratios (X1–X4) below.",
    "X1": "Working capital ÷ total assets. Measures short-term liquidity — can the SOE cover bills due soon with cash and near-cash assets?",
    "X2": "Retained earnings ÷ total assets. A running total of profit (or loss) kept in the business over its life — negative means accumulated losses.",
    "X3": "EBIT ÷ total assets. How much operating profit the SOE generates from what it owns, before interest and tax.",
    "X4": "Equity ÷ total liabilities. How much of the SOE is financed by its own capital versus borrowed money — negative equity means liabilities exceed what the SOE owns.",
    "Zone": "Safe, Grey, or Distress — a plain-language read of the Z-EM score. Safe > 2.6, Grey 1.1–2.6, Distress ≤ 1.1.",
    "Rating": "An indicative credit-rating letter grade (AAA…D) mapped from the Z-EM score, for reference only — not an actual credit rating from a rating agency.",
    "PD": "Probability of Distress — the estimated chance the SOE ends up in financial distress within a year, taken from the one-year PD of its Z-EM rating band (AAA…D).",
    "EAD": "Exposure at Default — how much money the government could be on the hook for if the SOE defaults. Currently approximated by Total Liabilities.",
    "LGD": "Loss Given Default — of the exposure (EAD), what share the government would actually lose, after any recovery (asset sales, restructuring). You set this — 100% means nothing is recovered.",
    "EFC": "Expected Fiscal Cost = PD × EAD × LGD. The average fiscal cost to government you'd expect if this scenario played out many times.",
    "Fuel shock": "How much more expensive fuel becomes, as a percentage. 25% means fuel prices rise by a quarter.",
    "Tariff pass-through": "How much of a fuel-price rise the SOE is allowed to charge back to customers. 0% means the SOE absorbs the whole shock itself; 100% means customers pay all of it and the SOE's costs are unaffected.",
    "FX shock": "How much the local currency weakens against a hard currency like the US dollar. 15% means it now takes 15% more local currency to buy the same US$1.",
    "Interest rate shock": "How much borrowing costs rise, in basis points (100 bps = 1 percentage point). Only affects the share of debt at a floating (adjustable) interest rate.",
    "GDP/demand shock": "How much the wider economy contracts or grows, which affects how much customers buy from the SOE.",
    "Revenue shock": "A shock to the SOE's revenue, sized in standard deviations of its own historical revenue volatility (or a sector default) rather than a flat percentage — the standard debt-sustainability-analysis convention.",
    "Refinancing shock": "The extra interest cost of rolling over debt that's coming due soon, at a stressed spread — distinct from a floating-rate shock, which reprices debt already on a variable rate.",
    "Government arrears": "Money the government owes the SOE (e.g. for services already delivered) but hasn't yet paid — this can squeeze the SOE's cash even if its accounting profit looks fine.",
    "Monte Carlo simulation": "Instead of one shock scenario, the tool runs thousands of random shock combinations to show a range of possible outcomes, not just one guess.",
    "Fiscal-at-risk": "The 95th-percentile Expected Fiscal Cost across all simulations — a 'bad but plausible' scenario, not the worst case and not the average.",
    "Tariff increase": "An end-user tariff increase decided as a policy response to the shock, as a percentage of revenue. 0% is a tariff freeze (Option A); 10–15% is a partial adjustment (Option B). It reduces what the State and the SOE have to cover.",
    "State compensation": "What the State owes the SOE for keeping tariffs below cost — for SENELEC, the gap between the regulator's Maximum Authorized Revenue (RMA) and tariff revenue. It is booked as revenue when due, but only the part actually paid arrives as cash.",
    "State compensation receivable": "Compensation the State has recognised but not yet paid. It sits in current assets, so profit looks fine, but it is not cash — the SOE has to borrow to pay its fuel bills in the meantime.",
    "Cash funding gap": "Cash the SOE is short of in a year because of losses, unpaid State compensation or input VAT it cannot recover. It is borrowed — short-term (overdrafts, short-term loans, late payment of suppliers) or long-term — and the new debt carries interest.",
    "Cash waterfall": "A priority-of-payments rule: the SOE's cash is paid out in a set order — for example taxes and the operator fee, then independent power producers (IPPs) and fuel, debt service and a reserve, the SOE's minimum operations and maintenance, and finally other suppliers. The order differs by country. It decides who is paid, not how much cash there is: when cash runs short, the lowest ranks go unpaid, so paying IPPs first can leave the SOE's own operations underfunded. Closing the gap takes tariffs or State payments.",
    "Underfunded operations": "Under the cash waterfall, the part of the year's cash shortfall left on the SOE's own costs — its O&M floor and its other operating costs — after the ranks above are paid.",
    "Cost-recovery ratio": "Average tariff divided by the full cost of supply (here operating expense, including depreciation, plus interest). Below 100%, the tariff gap has to be covered by State compensation or absorbed by the SOE.",
    "Shortfall rule": "Under the cash waterfall, who bears the part of the bills the cash cannot pay: the SOE's own operations, junior creditors (other suppliers, regulators, capex), both pro rata, or the State through a budget transfer.",
    "Logistic PD": "A probability of default that keeps rising as the Z-EM score falls, along an S-shaped curve PD = 1 / (1 + e^−(a + b·Z)), instead of stopping at the 40% of the lowest rating band.",
    "Refinancing": "Replacing short-term bank debt (overdrafts) with long-term loans. It moves debt out of current liabilities and can lower the interest rate, but it is a separate assumption: it depends on lenders agreeing, not on the payment order.",
    "Emergency support": "A capital injection from the government once the SOE cannot borrow any more (here: when total liabilities would pass a set share of total assets). It is a direct cost to the budget, on top of the expected fiscal cost.",
    "RMA coverage": "Customer revenue (revenue less government grants, plus any tariff increase or pass-through) as a share of the regulator's Maximum Authorized Revenue (RMA) after the fuel-cost change. The rest has to come from the State.",
    "Adjusted current ratio": "Current assets minus State compensation receivables and trapped VAT credits, divided by current liabilities. Shows liquidity once paper claims are left out; the reported current ratio can even rise when a receivable is funded with short-term debt.",
}

# ---------------------------------------------------------------------------
# Government support / strategic-SOE notch adjustment — a SIMPLIFIED, openly
# labeled proxy for S&P Global Ratings' "Rating Government-Related Entities:
# Methodology And Assumptions" (25-Mar-2015). This is NOT a replica of S&P's
# actual Role-Link matrix or notching tables (their real cell values weren't
# available to transcribe) — it is a transparent, editable stand-in built to
# the same two-dimensional logic: Role x Link -> a likelihood-of-support
# tier -> a bounded notch uplift, capped by the sovereign's own rating.
#
# Same rating alphabet as Z_RATING_TABLE above, so an SOE's Z-EM-derived
# rating and a sovereign's credit rating sit on one shared scale with no
# translation needed.
# ---------------------------------------------------------------------------

# Ascending order: index 0 = worst (D), index 19 = best (AAA). Matches the
# rating letters produced by z_rating() above.
RATING_SCALE_ASC = [
    "D", "CCC-", "CCC", "CCC+", "B-", "B", "B+", "BB-", "BB", "BB+",
    "BBB-", "BBB", "BBB+", "A-", "A", "A+", "AA-", "AA", "AA+", "AAA",
]
SOVEREIGN_RATING_OPTIONS = list(reversed(RATING_SCALE_ASC))  # best-first, for a dropdown
SOVEREIGN_OUTLOOK_OPTIONS = ["Stable", "Positive", "Negative"]


def rating_notch_shift(rating: str, notches: int) -> str:
    """Shift a rating letter up (positive) or down (negative) by `notches`,
    clipped to the scale's ends. Returns the input unchanged if it isn't a
    recognized rating (e.g. '—')."""
    if rating not in RATING_SCALE_ASC:
        return rating
    idx = RATING_SCALE_ASC.index(rating)
    idx = max(0, min(len(RATING_SCALE_ASC) - 1, idx + notches))
    return RATING_SCALE_ASC[idx]


def rating_index(rating: str):
    return RATING_SCALE_ASC.index(rating) if rating in RATING_SCALE_ASC else None


# --- Role: how important is a default of this SOE to the government? ---
# Paraphrased from S&P's Table 2 ("Assessing The Importance Of A GRE's Role
# To The Government").
ROLE_LEVELS = ["Critical", "Very Important", "Important", "Limited Importance"]
ROLE_SCORE = {"Critical": 4, "Very Important": 3, "Important": 2, "Limited Importance": 1}
ROLE_CRITERIA = {
    "Critical": "The SOE operates essentially on behalf of the government — providing a key public service the government would have to provide itself if the SOE didn't exist — or is among the most important SOEs in the country/sector.",
    "Very Important": "Default would have a major impact: either a not-for-profit entity central to a key policy objective, or a profit-seeking SOE whose distress would significantly disrupt the local economy.",
    "Important": "Default would have an important but manageable impact — the SOE provides essential infrastructure or services, or its distress would meaningfully affect one sector of the economy.",
    "Limited Importance": "Default would have a limited impact — one of many similar SOEs, easily substituted, or the government cares more about jobs/operations than its credit standing.",
}

# --- Link: how tightly bound is the government to this SOE? ---
# Paraphrased from S&P's Table 3 ("Assessing The Strength And Durability Of
# The Link Between The Government And A GRE").
LINK_LEVELS = ["Integral", "Very Strong", "Strong", "Limited"]
LINK_SCORE = {"Integral": 4, "Very Strong": 3, "Strong": 2, "Limited": 1}
LINK_CRITERIA = {
    "Integral": "Essentially an arm of, or very tightly controlled by, the government — a legal framework provides for explicit support, and there's a track record of considerable, timely credit support in all circumstances.",
    "Very Strong": "A very strong, durable link — the government is a strong stable shareholder driving strategy, and has a track record of very strong, timely credit support in most circumstances.",
    "Strong": "The government is an important (often controlling) shareholder with a policy or track record of support in certain circumstances, but governance is more independent, privatization may be contemplated, or a legal framework partly constrains intervention.",
    "Limited": "The government is a minority or non-shareholder with little interference, has very limited capacity or willingness to support on a timely basis, or a track record of adverse intervention.",
}

# --- Role x Link -> likelihood-of-support tier ---
# Simplified: sum the two ordinal scores (range 2-8) and map onto S&P's
# named tiers. This is a stand-in for S&P's actual Role-Link matrix (Table
# 1), not a reproduction of it.
LIKELIHOOD_TIERS_ASC = ["Low", "Moderate", "Moderately High", "High", "Very High", "Extremely High", "Almost Certain"]
_ROLE_LINK_SCORE_TO_TIER = {2: "Low", 3: "Moderate", 4: "Moderately High", 5: "High", 6: "Very High", 7: "Extremely High", 8: "Almost Certain"}


def role_link_to_likelihood(role: str, link: str) -> str:
    combined = ROLE_SCORE.get(role, 1) + LINK_SCORE.get(link, 1)
    return _ROLE_LINK_SCORE_TO_TIER.get(combined, "Low")


# Max notch uplift allowed for each likelihood tier, and the minimum gap
# that must remain below the sovereign's own rating (0 = may equalize with
# the sovereign; None on max_notches = uplift only bounded by the gap).
LIKELIHOOD_UPLIFT = {
    "Almost Certain": {"max_notches": None, "min_gap_to_sovereign": 0},
    "Extremely High": {"max_notches": 6, "min_gap_to_sovereign": 1},
    "Very High": {"max_notches": 5, "min_gap_to_sovereign": 2},
    "High": {"max_notches": 4, "min_gap_to_sovereign": 3},
    "Moderately High": {"max_notches": 3, "min_gap_to_sovereign": 4},
    "Moderate": {"max_notches": 2, "min_gap_to_sovereign": 5},
    "Low": {"max_notches": 0, "min_gap_to_sovereign": None},
}

# Dynamic cap (S&P criteria, paragraph 47): if the SOE's own rating has
# fallen sharply and the sovereign outlook is Negative, the support
# assumption itself is capped, regardless of the Role/Link inputs — this
# is what stops the notch uplift from freezing at an optimistic setting
# while the underlying SOE deteriorates.
DYNAMIC_CAP_TRIGGER_NOTCHES = 3  # rating fall (in notches) across available years that triggers the cap
DYNAMIC_CAP_TIER = "Moderate"  # likelihood tier ceiling once triggered


# ---------------------------------------------------------------------------
# Interactive HTML version (report.py, "Report" page)
#
# The HTML page runs the same calculations in the browser (templates/engine.js)
# with every number from this file; the settings here only decide what it shows. Trigger rules and the EFC/GDP status bands are
# illustrative, like the KPI cutoffs — recalibrate before official use.
# ---------------------------------------------------------------------------
REPORT_TITLE = "SOE Fiscal Risk Dashboard"

# KPIs shown in the scorecard's default "Headline" view (one or two per category).
REPORT_HEADLINE_KPIS = [
    "operating_margin", "roa", "current_ratio", "liabilities_to_assets",
    "debt_to_ebitda", "interest_coverage", "grants_to_revenue",
]

# Standard stress: shock magnitudes and exposures come from DEFAULT_SHOCK_PARAMS
# (DSA/DSF convention). Each channel below is also run on its own so the report
# can show which shock does the damage. Keys are DEFAULT_SHOCK_PARAMS magnitude keys.
REPORT_STRESS_CHANNELS = {
    "fuel": ("Fuel", "fuel_shock_pct"),
    "fx": ("FX", "fx_shock_pct"),
    "rate": ("Interest rate", "rate_shock_bps"),
    "revenue": ("Revenue", "revenue_shock_std_devs"),
    "refi": ("Refinancing", "refinancing_spread_bps"),
    "arrears": ("Arrears", "arrears_pct_of_revenue"),
}

# Plain-language glossary for the How it works page (from the draft explainer "How SOE Pilot Works").
HOW_GLOSSARY = [
    {"term": "State-owned enterprise (SOE)", "def": "A company owned or controlled by the government, such as a power, water, transport, telecoms or farming company."},
    {"term": "Contingent liability", "def": "A cost the government may have to pay only if something goes wrong, such as rescuing a state company."},
    {"term": "Triage", "def": "A quick first sort to decide which cases need attention first. SOE Pilot is a triage tool, not a forecast."},
    {"term": "Total assets", "def": "Everything the company owns: plants, networks, buildings, cash, money owed to it."},
    {"term": "Current assets", "def": "The part of what the company owns that turns into cash within a year: cash, customer bills, stock."},
    {"term": "Working capital", "def": "Current assets minus current liabilities: what is left of the money arriving within a year after paying the bills due within a year."},
    {"term": "Total liabilities", "def": "Everything the company owes: loans, bonds, supplier bills and other debts."},
    {"term": "Current liabilities", "def": "The part of what the company owes that must be paid within a year."},
    {"term": "Equity", "def": "What the company owns minus what it owes: the owners' cushion against losses."},
    {"term": "Operating profit (EBIT)", "def": "Earnings from the company's business before interest and tax are paid."},
    {"term": "Retained earnings", "def": "The running total of all past profits and losses kept in the company. Negative after years of losses."},
    {"term": "Distress score (Altman Z″-EM)", "def": "One number that combines the four health checks with fixed weights. Higher is healthier."},
    {"term": "Zone", "def": "Distress, Grey or Safe: three broad bands of the distress score."},
    {"term": "Indicative rating", "def": "A rating label (AAA to D) read off the distress score. Not an agency rating."},
    {"term": "Probability of distress (PD)", "def": "The chance that, in a given year, the company needs the government to rescue it."},
    {"term": "Exposure at default (EAD)", "def": "How much is at stake if the company needs a rescue. By default, everything it owes."},
    {"term": "Loss given default (LGD)", "def": "The share of the exposure the government ends up paying after recoveries. Default 70%."},
    {"term": "Expected fiscal cost (EFC)", "def": "Exposure × share the government bears × chance of distress. An average over possible futures, not the cost of a failure."},
    {"term": "Shock", "def": "A ‘what if’ applied to a company's accounts, such as a fuel price rise or a currency fall."},
    {"term": "Cash gap", "def": "Money the company needs in a year but doesn't have. By default the tool assumes it borrows to fill it."},
    {"term": "No-shock path", "def": "The company's accounts rolled forward with nothing going wrong. Every shock is compared with it."},
    {"term": "Monte Carlo simulation", "def": "Running the same calculation many times with randomly drawn shock sizes, to see the spread of outcomes."},
    {"term": "P50 (median)", "def": "The middle result: half the simulated outcomes are lower, half are higher."},
    {"term": "P95 (fiscal-at-risk)", "def": "The result that only 1 in 20 simulated outcomes exceeds. Still an expected cost, not the cost of a failure."},
    {"term": "Smooth PD curve (logistic)", "def": "A curve that turns any score into a PD without steps. Used only in Monte Carlo."},
    {"term": "Notch", "def": "One step on the rating ladder, for example from B to B+."},
    {"term": "Investment grade", "def": "The top part of the rating ladder, from BBB− up to AAA."},
    {"term": "Debt sustainability analysis (DSA)", "def": "The IMF and World Bank method for judging whether a country's debt is sustainable. Its standard stress tests set the shock sizes the tool uses."},
    {"term": "Basis point", "def": "One hundredth of a percentage point: 100 basis points = 1 percentage point."},
    {"term": "Draw", "def": "One randomly chosen set of shock sizes in a Monte Carlo simulation: one possible future."},
    {"term": "Arrears", "def": "Payments that are overdue. Government arrears are bills the government owes the company but has not paid."},
    {"term": "Refinancing", "def": "Replacing a loan that comes due with a new loan."},
    {"term": "EBITDA", "def": "Operating profit before depreciation and amortisation: roughly the cash the business generates from its activity."},
    {"term": "Sovereign rating", "def": "The credit rating of the government itself. It caps how far support can lift a company's rating."},
    {"term": "Nominal GDP", "def": "The value of everything a country produces in a year, in current prices. Used to show costs as a share of the economy."},
]

# Shock types offered on the Shock Scenarios page ("Custom shock" drop-down) and on the
# How it works page. Plain-language text for non-specialists: what the shock is, which SOEs it
# hits, which way is worse, and how it travels through the accounts. "guide" holds the size
# buttons (mild / standard / severe) for the main magnitude; "standard" equals the standard
# stress in DEFAULT_SHOCK_PARAMS. The sizes are illustrative: historical reference ranges
# (median, minimum and maximum change over 3-5 years) are still to be added by the team.
SHOCK_SIZE_NOTE = ("Sizes are illustrative starting points. 'Standard' is the DSA/DSF stress-test size. "
                   "Historical reference ranges (median, minimum and maximum change over three to five years) "
                   "are still to be added. If you have your own data, for example how much fuel prices rose "
                   "last year, use that number.")
SHOCK_TYPES = [
    {"id": "fuel", "label": "Fuel price", "key": "fuel_shock_pct",
     "what": "Fuel and other energy inputs become more expensive (or cheaper, if negative).",
     "who": "SOEs that burn a lot of fuel: power producers with oil or gas plants, airlines, shipping, bus and rail companies.",
     "direction": "Higher is worse: +25% means the fuel bill is a quarter higher.",
     "path": ["The fuel bill rises.",
              "Part of it may be passed on to customers through tariffs, or paid by the State as compensation.",
              "What is left lowers operating profit.",
              "The loss leaves a cash gap, which the SOE fills by borrowing.",
              "Less profit and more debt weaken the health checks, so the distress score falls.",
              "A higher chance of distress on a bigger debt raises the expected fiscal cost."],
     "results": "Lowers operating profit (health check 3) and, through losses and borrowing, savings (2) and the equity cushion (4).",
     "data": "Fuel cost as a share of operating expense, and the tariff and compensation rules of the regulator.",
     "guide": {"mild": 0.10, "standard": 0.25, "severe": 0.60}},
    {"id": "fx", "label": "Exchange rate (currency fall)", "key": "fx_shock_pct",
     "what": "The local currency loses value against the dollar or the euro (or gains, if negative).",
     "who": "SOEs with debt in foreign currency or imported inputs (fuel, equipment) but revenue in local currency.",
     "direction": "Higher is worse: 30% means the local currency loses 30% of its value.",
     "path": ["Costs paid in foreign currency rise; revenue earned in foreign currency rises too.",
              "Debt in foreign currency is worth more in local money (revaluation).",
              "Operating profit falls and the revaluation loss cuts equity straight away.",
              "Debt rises relative to assets, so the equity cushion (health check 4) thins.",
              "The distress score falls; the chance of distress and the expected fiscal cost rise."],
     "results": "Mostly through the equity cushion (health check 4) when much of the debt is in foreign currency; through operating profit (3) when costs are imported.",
     "data": "Share of debt in foreign currency (loan schedule), and shares of costs and revenue in foreign currency.",
     "guide": {"mild": 0.10, "standard": 0.30, "severe": 0.50}},
    {"id": "rates", "label": "Interest rates", "key": "rate_shock_bps",
     "what": "Borrowing costs rise: on floating-rate loans at once, and on debt that must be refinanced as it falls due.",
     "who": "SOEs with much floating-rate debt or much debt coming due soon (short-term loans, overdrafts).",
     "direction": "Higher is worse: +200 basis points means +2 percentage points.",
     "path": ["Interest on floating-rate debt, and on debt that is rolled over, goes up.",
              "Operating profit does not change, but net income falls.",
              "The loss is borrowed, so debt and interest grow further.",
              "Savings (health check 2) and the equity cushion (4) shrink.",
              "The distress score falls; the chance of distress and the expected fiscal cost rise."],
     "results": "Works through net income, so it shows in savings (health check 2) and the equity cushion (4), not in operating profit.",
     "data": "Share of debt at floating rates and the amount of debt coming due within a year (loan schedule).",
     "guide": {"mild": 100, "standard": 200, "severe": 400}},
    {"id": "revenue", "label": "Revenue fall (any cause)", "key": "revenue_shock_std_devs",
     "what": "Sales fall for any reason: lower demand, a collapse in tourism, a drought, a pandemic. Use it when the shock you have in mind is not in this list.",
     "who": "SOEs whose revenue swings a lot, or that depend on one market (tourism, exports, a commodity).",
     "direction": "A bigger fall is worse. Set it as a % of revenue; the tool also shows it in standard deviations of the SOE's own revenue growth (the DSA convention is −1).",
     "path": ["Revenue falls while costs stay where they were.",
              "Operating profit drops by the share of the lost revenue that reaches profit.",
              "The loss leaves a cash gap, filled by borrowing.",
              "All four health checks weaken, so the distress score falls.",
              "The chance of distress and the expected fiscal cost rise."],
     "results": "Lowers operating profit (health check 3) first, then savings (2), working capital and the equity cushion (1, 4).",
     "data": "Several years of revenue (the tool measures the SOE's own revenue volatility), or your own estimate of the fall.",
     "guide": {"mild": -0.5, "standard": -1.0, "severe": -2.0}},
    {"id": "arrears", "label": "Government arrears", "key": "arrears_pct_of_revenue",
     "what": "The government does not pay bills it owes the SOE (for electricity, water or transport services, or compensation), and part of what is owed is written off.",
     "who": "SOEs that sell a lot to ministries, agencies and other SOEs, or that rely on State compensation.",
     "direction": "Higher is worse: the share of a year's revenue written off each shock year. 0 means the government pays on time.",
     "path": ["Money the government owes the SOE is written off.",
              "Current assets and equity fall at once (no effect on operating profit).",
              "Working capital (health check 1), savings (2) and the equity cushion (4) weaken.",
              "The distress score falls; the chance of distress and the expected fiscal cost rise.",
              "The write-off cannot exceed the receivables and other non-cash current assets the SOE has."],
     "results": "Hits working capital (health check 1), savings (2) and the equity cushion (4); operating profit is unchanged.",
     "data": "Receivables from the government and public agencies, and how long they have been overdue.",
     "guide": {"mild": 0.02, "standard": 0.05, "severe": 0.15}},
]

# EFC as a share of GDP — status bands for the overview tile (illustrative).
REPORT_EFC_GDP_WATCH = 0.005
REPORT_EFC_GDP_ALERT = 0.010

# Trigger rules evaluated per SOE in report.py (evaluation logic keyed by id).
# level: "alert" | "watch" | "ok". Actions are examples of pre-agreed responses.
# category groups the rules on the Early Warning tab (filter chips); steps are the specific,
# illustrative follow-up actions shown for an SOE that fires the rule. They follow common
# SOE-oversight practice and still have to be agreed with the Ministry of Finance and aligned
# with Bank / IMF / governance-team guidance before use.
TRIGGER_CATEGORIES = ["Overall health", "Solvency & debt", "Liquidity", "Stress test", "Trend", "Fiscal dependency"]
TRIGGER_RULES = [
    {"id": "distress", "level": "alert", "short": "Distress zone", "category": "Overall health",
     "condition": f"Distress score (Z″) ≤ {Z_DISTRESS_CUTOFF} (distress zone)",
     "action": "Activate the intervention protocol · require a restructuring plan · budget the expected fiscal cost explicitly for next year",
     "steps": ["Within a month: the oversight unit informs the Ministry of Finance and the SOE board meets on the findings",
               "Within three months: the SOE submits a financial recovery plan with measurable targets (costs, collections, tariffs, debt)",
               "Budget the SOE's expected fiscal cost explicitly and disclose it in the fiscal risk statement",
               "Quarterly reporting to the oversight unit until the SOE leaves the distress zone"]},
    {"id": "neg_equity", "level": "alert", "short": "Negative equity", "category": "Solvency & debt",
     "condition": "Book equity ≤ 0 (liabilities exceed assets)",
     "action": "Treat liabilities as a likely call on the budget · assess recapitalisation against restructuring",
     "steps": ["Independent review of the balance sheet: asset values, unrecorded liabilities, arrears",
               "Compare the options on cost to the budget: recapitalisation with conditions, restructuring, merger or liquidation",
               "Record the SOE's liabilities as a contingent liability in the fiscal risk statement"]},
    {"id": "debt_ebitda", "level": "alert", "short": "Debt/EBITDA", "category": "Solvency & debt",
     "condition": f"Debt/EBITDA > {KPI_THRESHOLDS['debt_to_ebitda']['red_cut']:.0f}× or EBITDA ≤ 0",
     "action": "Prior approval for new borrowing and guarantees · review tariffs and public-service compensation",
     "steps": ["Immediate board meeting and review by the oversight committee of the SOE's debt plan",
               "Ministry of Finance prior approval for any new borrowing or guarantee",
               "Check the maturity profile: refinance debt coming due before it falls due, avoid short-term rollovers",
               "Review tariffs and public-service compensation"]},
    {"id": "interest_cover", "level": "alert", "short": "Interest not covered", "category": "Solvency & debt",
     "condition": f"Operating profit / interest < {KPI_THRESHOLDS['interest_coverage']['red_cut']:.0f}× (debt service at risk)",
     "action": "Prepare for debt service problems · talk to lenders early · no new non-concessional borrowing",
     "steps": ["Prepare a 12-month debt-service schedule and identify the payments at risk",
               "Talk to lenders early about rescheduling rather than waiting for an emergency budget transfer",
               "No new non-concessional borrowing until operating profit covers interest again"]},
    {"id": "liquidity", "level": "watch", "short": "Liquidity squeeze", "category": "Liquidity",
     "condition": f"Current ratio < {KPI_THRESHOLDS['current_ratio']['red_cut']:.1f}× (bills due within a year exceed liquid assets)",
     "action": "Monthly cash-flow monitoring · settle government arrears to the SOE · line up short-term financing",
     "steps": ["Monthly cash-flow forecast sent to the oversight unit",
               "Check arrears both ways: what the State owes the SOE (settle first) and what the SOE owes suppliers",
               "Line up short-term financing before payments fall due"]},
    {"id": "stress_drop", "level": "alert", "short": "Fails stress test", "category": "Stress test",
     "condition": "Standard stress drops the SOE one zone or more below its no-shock path",
     "action": "Record the contingent liability in the fiscal risk statement · consider risk financing for the exposure",
     "steps": ["Record the SOE and its stress-test result in the fiscal risk statement",
               "Find the shock that hurts most (Shock Scenarios tab) and ask the SOE for a contingency plan for it",
               "Consider a contingency reserve or other risk financing for the exposure"]},
    {"id": "grey", "level": "watch", "short": "Grey zone", "category": "Overall health",
     "condition": f"{Z_DISTRESS_CUTOFF} < Z″ ≤ {Z_SAFE_CUTOFF} (grey zone)",
     "action": "Quarterly financial monitoring · require a performance improvement plan",
     "steps": ["Quarterly financial monitoring",
               "Performance improvement plan with two or three targets (costs, collections, tariff)",
               "Re-run the stress test as soon as new accounts arrive"]},
    {"id": "rating_fall", "level": "watch", "short": "Rating falling", "category": "Trend",
     "condition": f"Indicative rating down {DYNAMIC_CAP_TRIGGER_NOTCHES}+ notches from the first to the latest year",
     "action": "Commission a deep-dive review · do not count on government support to hold the rating up",
     "steps": ["Check whether the fall comes from one bad year or a steady trend",
               "Commission a deep-dive review (for power utilities, the energy-sector fiscal-risk model)",
               "Do not count on government support to hold the rating up"]},
    {"id": "grant_dependency", "level": "watch", "short": "Grant-dependent", "category": "Fiscal dependency",
     "condition": f"Grants / revenue > {KPI_THRESHOLDS['grants_to_revenue']['red_cut']:.0%} — Z″ likely overstates health",
     "action": "Read Z″ together with fiscal-dependency KPIs · review the transfer framework",
     "steps": ["Read the distress score together with the fiscal-dependency ratios (KPI Dashboard)",
               "Review the transfer framework: what pays for public-service obligations, what covers losses",
               "Make transfers rule-based and budgeted"]},
    {"id": "routine", "level": "ok", "short": "Routine", "category": "Overall health",
     "condition": f"Z″ > {Z_SAFE_CUTOFF} and no other rule fires",
     "action": "Routine annual monitoring",
     "steps": ["Annual monitoring with audited accounts", "Keep the SOE's data in the standard template up to date"]},
]


# ---------------------------------------------------------------------------
# Parameter register — every number the tool uses, where it comes from, and
# whether it is backed by literature / data, set by the user, a working proxy,
# or a placeholder that still needs a source. Shown on the "Assumptions &
# sources" page and in the HTML version, so no number in the dashboard is a
# magic number. Keep it in step when you change a value above.
#   status: "literature" | "user" | "proxy" | "placeholder" | "design"
# ---------------------------------------------------------------------------
PARAMETER_STATUS_LABELS = {
    "literature": "Literature / data",
    "user": "User-set in the tool",
    "proxy": "Proxy — working assumption",
    "placeholder": "Placeholder — needs a source",
    "design": "Model design choice — needs justification",
}


def _p(group, parameter, value, status, source, used_in):
    return {"group": group, "parameter": parameter, "value": value, "status": status, "source": source, "used_in": used_in}


_S = DEFAULT_SHOCK_PARAMS
PARAMETER_REGISTER = [
    _p("Distress score", "Z″ coefficients (X1–X4)", ", ".join(f"{k} {v}" for k, v in ZEM_COEFFICIENTS.items()), "literature",
       "Altman, Hartzell & Peck (1995); Altman (2005), Emerging Markets Review 6(4) — four-ratio Z″ for non-manufacturers", "Altman Z-EM, every downstream page"),
    _p("Distress score", "Constant", f"{ZEM_CONSTANT}", "literature",
       "Z″ (Eidelman) convention without the +3.25 EM constant — citation to verify", "Altman Z-EM"),
    _p("Distress score", "Zone cutoffs", f"distress ≤ {Z_DISTRESS_CUTOFF}, safe > {Z_SAFE_CUTOFF}", "literature",
       "Altman Z″ zones (1.1 / 2.6) for the constant-free score", "Altman Z-EM, EFC, triggers"),
    _p("Distress score", "Rating bands (20, AAA…D)", "Z_RATING_TABLE", "literature",
       "Rating cohort table supplied to the project (Altman 2005 mapping) — original source to cite", "Ratings, PD"),
    _p("Probability of distress", "One-year PD by rating", "0.02% (AAA) … 40% (D)", "literature",
       "PD column of the rating cohort table — S&P annual default study, year to confirm", "EFC, shocks, Monte Carlo"),
    _p("Probability of distress", "Zone-maximum PD", "max PD among bands overlapping the zone", "placeholder",
       "Interim reference pending a dedicated maximum-PD table", "EFC backstop chart"),
    _p("Probability of distress", "Legacy PD by zone", ", ".join(f"{k} {v:.0%}" for k, v in PD_BY_ZONE.items()), "placeholder",
       "SOE shock framework note (s.10); kept only as a documented legacy value, not used", "—"),
    _p("Exposure at default", "EAD basis", f"share × total liabilities (default {EAD_SHARE_DEFAULT:.0%}); guaranteed debt if observed", "proxy",
       "Implicit-guarantee assumption; 60% / 80% sensitivity cases from the team discussion", "EFC, shocks"),
    _p("Loss given default", "LGD", f"{LGD_SLIDER_DEFAULT}% default, {LGD_SLIDER_MIN}–{LGD_SLIDER_MAX}%", "user",
       "Set by the user; GEMs sector values shown as reference", "EFC, shocks"),
    _p("Loss given default", "Sector LGD reference (GEMs)", "Avg / P10 / P25 / P90 by sector", "literature",
       "GEMs Consortium (2025), Default and Recovery Statistics: Public Lending 1994–2024, Table 26 — lender recovery rate taken as government LGD (working assumption)", "EFC backstop chart"),
    _p("KPIs", "Red / amber / green cutoffs (16 ratios)", "see KPI_THRESHOLDS", "placeholder",
       "IMF SOE Health Check Tool-style starting points; not calibrated to a country or sector sample", "KPI Dashboard, triggers"),
    _p("KPIs", "Suppression rule", "ROE, D/E, D/EBITDA, Dep/EBITDA, ETR → n/a when the denominator ≤ 0", "design",
       "Avoids reading a sign-flipped ratio as good; shown as a flag", "KPI Dashboard"),
    _p("Shock magnitudes", "FX depreciation (standard stress)", f"{_S['fx_shock_pct']:.0%}", "literature",
       "IMF–World Bank LIC DSF Guidance Note (2018) standard exchange-rate shock — paragraph to cite", "Standard stress, Early Warning"),
    _p("Shock magnitudes", "Interest-rate shock (standard stress)", f"+{_S['rate_shock_bps']:.0f} bps", "literature",
       "DSF / MAC SRDSF standard interest-rate shock — paragraph to cite", "Standard stress"),
    _p("Shock magnitudes", "Revenue shock (standard stress)", f"{_S['revenue_shock_std_devs']:+.0f} s.d. of own revenue growth", "literature",
       "DSF convention of shocks sized in historical standard deviations", "Standard stress"),
    _p("Shock magnitudes", "Fuel price shock (standard stress)", f"+{_S['fuel_shock_pct']:.0%}", "placeholder",
       "Illustrative; calibrate from oil-price history (e.g. a one-s.d. annual move)", "Standard stress"),
    _p("Shock magnitudes", "Refinancing spread (standard stress)", f"+{_S['refinancing_spread_bps']:.0f} bps", "placeholder",
       "Illustrative; calibrate from sovereign/SOE spread episodes", "Standard stress"),
    _p("Shock magnitudes", "Government arrears (standard stress)", f"{_S['arrears_pct_of_revenue']:.0%} of revenue a year", "placeholder",
       "Illustrative; calibrate from arrears data where available", "Standard stress"),
    _p("Shock magnitudes", "Size guide (mild / standard / severe)",
       "; ".join(f"{t['label']}: {t['guide']['mild']:g} / {t['guide']['standard']:g} / {t['guide']['severe']:g}" for t in SHOCK_TYPES), "placeholder",
       "Illustrative; replace with historical median, minimum and maximum changes over 3-5 years", "Shock Scenarios (Custom shock)"),
    _p("Shock magnitudes", "Portfolio macro shock (default sizes)", "revenue −10% for every SOE, borrowing cost +200 bps; severity drawn ±50% (300 draws)", "design",
       "Set by the user; ranks SOEs by the expected fiscal cost the same shock adds, not a sum of simultaneous failures", "Shock Scenarios (Portfolio macro shock)"),
    _p("Shock dynamics", "Shock profile", f"full magnitude for {_S['shock_duration_years']} years, then off (no AR(1)); fuel can follow a per-year path instead", "design",
       "Step profile chosen for transparency; persistence (years) to be justified from data — the tool does not use an AR(1) process. "
       "The fuel channel also takes an explicit annual price path (fuel_shock_path), as the IMF SOE Stress Test Tool does for oil", "Shock Scenarios, Monte Carlo"),
    _p("Shock dynamics", "Projection horizon", f"{MC_HORIZON_YEARS} years (1–7)", "user", "Set by the user", "Shock Scenarios"),
    _p("Exposures", "Sector fuel cost share of opex", ", ".join(f"{k} {v:.0%}" for k, v in SECTOR_FUEL_COST_SHARE.items()), "literature",
       "SOE fuel-shock framework note (April 2026, internal) — source table to cite; used only when the SOE's own fuel data are missing", "Fuel shock"),
    _p("Exposures", "Default exposure shares", ", ".join(f"{k} {v:g}" for k, v in DEFAULT_EXPOSURES.items() if k not in ("revenue_elasticity", "fuel_subsidy_share")), "placeholder",
       "Generic starting values; replaced per SOE when the data carry FX / floating / short-term debt / fuel columns (bottom-up)", "Shock Scenarios"),
    _p("Exposures", "EBIT elasticity to revenue", f"{DEFAULT_EXPOSURES['revenue_elasticity']}", "placeholder",
       "1.0 = costs fixed in the short run; estimate from the SOE's cost structure", "Revenue shock"),
    _p("Exposures", "Tariff pass-through of fuel costs", f"{DEFAULT_EXPOSURES['tariff_passthrough']:.0%}", "placeholder",
       "Depends on the regulatory regime; set per SOE / sector", "Fuel shock"),
    _p("Exposures", "State compensation share of fuel costs (Case C)", f"{DEFAULT_EXPOSURES['fuel_subsidy_share']:.0%} (off)", "user",
       "Set by the user; the compensated amount is reported as a fiscal cost next to EFC", "Fuel shock"),
    _p("Fuel policy and cash", "End-user tariff increase", f"{_S['tariff_increase_pct']:.0%} (Option A freeze); 10–15% for Option B", "user",
       "Policy scenario set by the user", "Fuel shock"),
    _p("Fuel policy and cash", "State compensation paid in the same year", f"{DEFAULT_CASH_SETTINGS['comp_paid_share']:.0%} (oil preset {OIL_SHOCK_PRESET['comp_paid_share']:.0%})", "literature",
       "SENELEC 2022: 333.2 bn of RMA compensation recognised and 135.8 bn still receivable from the State at year-end (≈60% paid in-year); the 100% default keeps the original model", "Shock Scenarios"),
    _p("Fuel policy and cash", "Unpaid compensation collected the next year", f"{DEFAULT_CASH_SETTINGS['comp_backlog_collected']:.0%}", "placeholder",
       "Assumes payment lags under a year; lower it where arrears to the SOE pile up", "Shock Scenarios"),
    _p("Fuel policy and cash", "Unpaid compensation written off as a loss", f"{DEFAULT_CASH_SETTINGS['comp_provision_share']:.0%}", "user",
       "0% keeps it as a receivable; 100% is the 'treat unpaid compensation as a loss' proxy", "Shock Scenarios"),
    _p("Fuel policy and cash", "Cash gap funded short-term / via supplier arrears", f"{DEFAULT_CASH_SETTINGS['cash_gap_short_term_share']:.0%} / {DEFAULT_CASH_SETTINGS['cash_gap_payables_share']:.0%} (oil preset {OIL_SHOCK_PRESET['cash_gap_short_term_share']:.0%} / {OIL_SHOCK_PRESET['cash_gap_payables_share']:.0%})", "design",
       "0% reproduces the original model (losses funded long-term, current liabilities flat)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Interest rate on new borrowing", f"{DEFAULT_CASH_SETTINGS['new_debt_interest_rate']:.1%} (oil preset {OIL_SHOCK_PRESET['new_debt_interest_rate']:.1%})", "literature",
       "SENELEC 2024: interest expense 14.6 bn / borrowings 430.8 bn = 3.4%, rounded to 3.3%; the 0% default keeps the original model. Replace with the SOE's own borrowing cost", "Shock Scenarios"),
    _p("Fuel policy and cash", "Cash drawn before borrowing (cash-first)", f"{DEFAULT_CASH_SETTINGS['cash_buffer_share']:.0%} of the shortfall, from 'Cash and Equivalents'", "design",
       "IMF SOE Stress Test Tool User Guide (2023), Section VIII: liquidity gaps are met from cash first, then borrowing, then injections; "
       "many SOEs cannot borrow quickly. 0% restores the original borrow-everything rule; inert when the data report no cash", "Shock Scenarios"),
    _p("Fuel policy and cash", "Cash floor kept back", f"{DEFAULT_CASH_SETTINGS['cash_floor_opex_share']:.0%} of operating expense", "design",
       "Minimum operating cash not drawn; 0% lets the whole opening balance be used. Set from the SOE's own cash-management rule", "Shock Scenarios"),
    _p("Fuel policy and cash", "Tariff increase base", f"{DEFAULT_CASH_SETTINGS['tariff_revenue_base']} (oil preset {OIL_SHOCK_PRESET['tariff_revenue_base']})", "literature",
       "SENELEC 2024: 214.7 bn of RMA compensation is booked inside revenue (1,015.2 bn), so a +15% tariff applies to customer sales (800.5 bn) only", "Fuel shock"),
    _p("Fuel policy and cash", "Input VAT on the extra fuel bill", f"rate {DEFAULT_CASH_SETTINGS['vat_rate']:.0%}, unrecovered {DEFAULT_CASH_SETTINGS['vat_trapped_share']:.0%}", "placeholder",
       "Senegal standard VAT rate; the unrecovered share depends on the SOE's VAT-exempt sales", "Shock Scenarios"),
    _p("Fuel policy and cash", "Cash waterfall (priority of payments)", "off (button: on)", "design",
       "Ranked tiers, same rank = pari passu (pro rata to the year's bills): taxes, levies and operator fee; IPPs; fuel and gas; senior debt service; "
       "reserve; the SOE's O&M floor; the SOE's other costs and junior creditors. No cash is created: the routed shortfall is not borrowed but left "
       "unpaid from the lowest rank up, or paid by the State (task team comment, 20 Oct 2026: the waterfall prioritizes payment but does not create "
       "cash; IPP priority can leave the SOE underfunded)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Order of payment (country presets)", ", ".join(o["short"] for o in WATERFALL_ORDERS.values()), "design",
       "Senegal: IPPs first (SENELEC note). Ghana: PURC validation report, May 2025 (Level A IPPs, WAPCo and Fuel Account; statutory deductions; "
       "Level B SOEs and regulators pro rata). Côte d'Ivoire: operator (CIE) first, then IPPs and gas pari passu — task team review, not "
       "independently verified. Ranks of debt service and reserves are not confirmed for Ghana or Côte d'Ivoire: assumptions", "Shock Scenarios"),
    _p("Fuel policy and cash", "Shortfall rule", f"{DEFAULT_CASH_SETTINGS['shortfall_rule']} (SOE absorbs first); Ghana preset pro rata", "design",
       "Task team review: who absorbs a deficit — the SOE, the State through compensation, or unpaid junior creditors", "Shock Scenarios"),
    _p("Fuel policy and cash", "Taxes, levies and operator fee (rank 0)", f"{DEFAULT_CASH_SETTINGS['statutory_cost_share']:.0%} of OpEx + reported tax expense", "placeholder",
       "Task team review: rank zero for taxes, levies and the operator or collection costs (Ghana statutory deductions; CIE remuneration)", "Shock Scenarios"),
    _p("Fuel policy and cash", "O&M floor", f"{DEFAULT_CASH_SETTINGS['om_floor_share']:.0%} of the SOE's own costs", "placeholder",
       "Task team review: test whether operations and maintenance are guaranteed or can be squeezed to zero; set from the SOE's minimum maintenance budget", "Shock Scenarios"),
    _p("Fuel policy and cash", "Junior creditors (other suppliers, regulators, capex)", f"{DEFAULT_CASH_SETTINGS['junior_share']:.0%} of own costs", "placeholder",
       "Residual tier of the review's suggested structure", "Shock Scenarios"),
    _p("Fuel policy and cash", "Coverage and compliance", f"{DEFAULT_CASH_SETTINGS['waterfall_coverage']:.0%} × {DEFAULT_CASH_SETTINGS['waterfall_compliance']:.0%}", "user",
       "Task team review: which collections enter the account, and imperfect adoption (test 60–100% of cash actually routed)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Start year and ramp-up", f"year {DEFAULT_CASH_SETTINGS['waterfall_start_year']:.0f}, {DEFAULT_CASH_SETTINGS['waterfall_rampup_months']:.0f} months", "user",
       "Task team review: allow a phase-in of 12 to 24 months; linear, averaged over each year", "Shock Scenarios"),
    _p("Fuel policy and cash", "Late-payment interest on arrears", "0% (IPPs and fuel, debt, other)", "placeholder",
       "Set from the PPA late-payment clauses, fuel contracts and loan documents; on arrears at the start of each year", "Shock Scenarios"),
    _p("Fuel policy and cash", "Missed debt service = default", "on: rated D, PD on default 100% (40% option)", "design",
       "A year that ends with debt service unpaid under the waterfall is a payment default (team discussion with H. Hiro, Oct 2026)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Supplier and State responses", "price cut 0%, State paid share +0", "placeholder",
       "Task team review: scenario parameters for supplier terms in return for priority and for more reliable State payment; 0 = no behavioural response", "Shock Scenarios"),
    _p("Tariffs and collections", "Cost-recovery ratio", "as in the data (0); test 85–110%", "user",
       "Task team review: average tariff / full cost of supply, the most important single input. Full cost = operating expense (incl. depreciation) + interest", "Shock Scenarios"),
    _p("Tariffs and collections", "State share of the tariff gap", f"{DEFAULT_CASH_SETTINGS['tariff_gap_state_share']:.0%}", "user",
       "Share of a change in the tariff gap compensated by the State (SENELEC: RMA compensation), paid in cash at the in-year paid share", "Shock Scenarios"),
    _p("Tariffs and collections", "State receivable in current assets", f"{DEFAULT_CASH_SETTINGS['receivable_current_share']:.0%}", "user",
       "Task team review: whether subsidy receivables count as current assets and are collectible can swing X1 more than the waterfall", "Shock Scenarios"),
    _p("Tariffs and collections", "Collection rates by segment",
       f"households {DEFAULT_CASH_SETTINGS['collect_households']:.0%}, large private {DEFAULT_CASH_SETTINGS['collect_large_private']:.0%}, public {DEFAULT_CASH_SETTINGS['collect_public']:.0%}; "
       f"shares {DEFAULT_CASH_SETTINGS['share_households']:.0%}/{DEFAULT_CASH_SETTINGS['share_large_private']:.0%}/{DEFAULT_CASH_SETTINGS['share_public']:.0%}", "placeholder",
       "Task team review: public administrations usually the weakest payer. Sales shares are placeholders; set from the SOE's billing data", "Shock Scenarios"),
    _p("Tariffs and collections", "Demand growth and losses", "0% / 0%", "user",
       "Macro drivers in the task team review; demand growth scales sales and cash costs together, losses cut customer revenue at the same cost", "Shock Scenarios"),
    _p("Probability of distress", "PD method", f"{DEFAULT_CASH_SETTINGS['pd_method']}; logistic sensitivity a {DEFAULT_CASH_SETTINGS['pd_logit_a']}, b {DEFAULT_CASH_SETTINGS['pd_logit_b']}", "placeholder",
       "Deterministic default is the rating band PD. Logistic coefficients (Monte Carlo sensitivity) minimize the maximum absolute percentage-point deviation at the 20 reference rating midpoint anchors; illustrative reference PDs, not realized SOE defaults.", "Shock Scenarios"),
    _p("Probability of distress", "Monte Carlo expected fiscal cost", "Rating-anchored PD (AAA floor, logistic tail below the D threshold) is the core model; single logistic as same-draw sensitivity; no default-event draws", "design",
       "Monte Carlo outputs use a monotone curve through the 20 rating band PDs, interpolated in Z-EM between band centres, floored at 0.02% at or above 4.9 and, below Z-EM -1.5 (the D threshold), rising along a logistic tail from 40% with slope b (the logistic slope b), for EFC=PD×EAD×LGD; the single logistic sigmoid(a+b×Z-EM) is a side-by-side same-draw sensitivity; deterministic tabs use the rating band PD; no simulated defaults or realised loss payouts.", "Shock Scenarios (Monte Carlo)"),
    _p("Fuel policy and cash", "IPP purchases, share of operating expense", f"{DEFAULT_CASH_SETTINGS['ipp_cost_share']:.0%} (oil preset {OIL_SHOCK_PRESET['ipp_cost_share']:.0%})", "proxy",
       "SENELEC 2022: purchased electricity ≈ COGS 647.4 bn − fuel 494.9 bn = 152.5 bn, / operating expense 888.5 bn; includes OMVS and imports, "
       "so an upper bound for IPPs alone. Used only to size tier 1 of the waterfall", "Shock Scenarios"),
    _p("Fuel policy and cash", "Reserve account target", f"{DEFAULT_CASH_SETTINGS['reserve_months']:.0f} months of IPP payments and debt service", "user",
       "Set from the escrow or debt-service reserve agreement; funded from surpluses after the priority arrears, drawn before priority creditors go unpaid", "Shock Scenarios"),
    _p("Fuel policy and cash", "Short-term bank debt refinanced", f"{DEFAULT_CASH_SETTINGS['refinance_share']:.0%}", "user",
       "Separate from the waterfall: depends on lenders. Debt base 'Short Term Debt', else near-term maturity share × total liabilities; moved out of "
       "current liabilities in the start year (default year 1), or later once the previous year's rating meets the minimum (task team review: "
       "a refinancing benefit takes a year or more and depends on rating and investor confidence)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Overdraft rate (refinanced)", f"{DEFAULT_CASH_SETTINGS['short_term_debt_rate']:.1%}", "literature",
       "SENELEC note (2026): short-term overdrafts at 7.5–8.5%; mid-point", "Shock Scenarios"),
    _p("Fuel policy and cash", "Long-term rate on refinanced debt", f"{DEFAULT_CASH_SETTINGS['refinance_long_term_rate']:.1%}", "placeholder",
       "Cost of the structured long-term loans that replace the overdrafts; set from the refinancing term sheet (DFI / concessional terms are lower)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Borrowing cap before emergency support", "off (0)", "user",
       "IMF SOE Stress Test Tool User Guide (2023), Section VIII: cash, then borrowing, then government injection. Set a total-liabilities / total-assets ceiling "
       "(e.g. a covenant or the debt limit in the performance contract); the shortfall above it is a capital injection. Under the cash waterfall it applies "
       "only to the cash outside it", "Shock Scenarios"),
    _p("Fuel policy and cash", "Oil-shock preset: fuel price path", "/".join(f"{v:+.0%}" for v in OIL_SHOCK_PRESET["fuel_shock_path"]) + " (years 1–5)", "literature",
       "Task team scenario (email of 16 Oct 2026): oil and HFO +60% in 2026; +30% in 2027 is a half-reversion assumption, then back to the base price", "Shock Scenarios"),
    _p("Fuel policy and cash", "Oil-shock preset: fuel share of operating expense", f"{OIL_SHOCK_PRESET['fuel_cost_share']:.0%} of OpEx", "literature",
       "SENELEC annual report 2022: fuel purchases 494.9 bn / operating expense 888.5 bn = 0.557, rounded down; IPP electricity purchases excluded (0.70 sensitivity)", "Shock Scenarios"),
    _p("Fuel policy and cash", "Oil linkage of the fuel bill", f"{DEFAULT_CASH_SETTINGS['fuel_oil_linkage']:g} (oil preset {OIL_SHOCK_PRESET['fuel_oil_linkage']:g})", "literature",
       "SENELEC annual report 2022: HFO 361.9 bn and coal 35.7 bn within 494.9 bn of fuel purchases; coal does not follow the oil price, so about 0.9 of the bill does. "
       "With the fuel share it is the IMF tool's 'share of oil in purchased inputs'", "Fuel shock"),
    _p("Exposures", "Revenue volatility fallback", ", ".join(f"{k} {v:.0%}" for k, v in SECTOR_REVENUE_VOLATILITY.items()), "placeholder",
       "Used only when an SOE has fewer than three years of revenue", "Revenue shock"),
    _p("Monte Carlo", "Fuel / FX standard deviations", f"{MC_DEFAULT_FUEL_STD:.0%} / {MC_DEFAULT_FX_STD:.0%}", "placeholder",
       "Calibrate from historical annual changes for the country", "Monte Carlo"),
    _p("Monte Carlo", "Interest-rate / revenue standard deviations", f"{MC_DEFAULT_RATE_STD_BPS:.0f} bps / {MC_DEFAULT_REVENUE_STD_SD:g} s.d. (off)", "user",
       "Off by default; set to draw these shocks too", "Monte Carlo"),
    _p("Monte Carlo", "Shock correlations", ", ".join(f"{k.replace('|', '–')} {v:g}" for k, v in MC_DEFAULT_CORRELATIONS.items() if v), "placeholder",
       "Fuel–FX 0.30 reflects co-movement for fuel importers; estimate the matrix from country data", "Monte Carlo"),
    _p("Fiscal context", "Nominal GDP growth", f"{DEFAULT_GDP_GROWTH:.0%}", "user", "Set by the user", "EFC / GDP paths"),
    _p("Government support", "Role and Link scores, tier mapping, uplift table", "4 + 4 levels → 7 tiers", "proxy",
       "Simplified stand-in for S&P Global Ratings, Rating GREs: Methodology and Assumptions (25 March 2015); S&P matrix not transcribed", "Government Support"),
    _p("Government support", "Dynamic cap trigger", f"rating down {DYNAMIC_CAP_TRIGGER_NOTCHES}+ notches or Negative outlook → {DYNAMIC_CAP_TIER}", "proxy",
       "After S&P GRE criteria (para. 47) — paragraph to verify", "Government Support"),
    _p("Early warning", "Trigger rules and actions", f"{len(TRIGGER_RULES)} rules", "placeholder",
       "Illustrative rules and pre-agreed actions for discussion with the Ministry of Finance", "Early Warning, Report"),
    _p("Early warning", "EFC / GDP bands", f"watch {REPORT_EFC_GDP_WATCH:.1%}, alert {REPORT_EFC_GDP_ALERT:.1%}", "placeholder",
       "Illustrative; relate to the fiscal risk statement's materiality threshold", "Home, Report"),
    _p("Narrative", "Single-driver share / strong-component thresholds", f"{SINGLE_DRIVER_SHARE_THRESHOLD:.0%} / X1 {ZEM_COMPONENT_STRONG_THRESHOLD['X1']}, X2 {ZEM_COMPONENT_STRONG_THRESHOLD['X2']}, X3 {ZEM_COMPONENT_STRONG_THRESHOLD['X3']}, X4 {ZEM_COMPONENT_STRONG_THRESHOLD['X4']}", "placeholder",
       "Wording thresholds for the automated summaries only", "Altman Z-EM text"),
]
