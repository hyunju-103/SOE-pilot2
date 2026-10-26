"""Illustrative, monotone logit-cubic curve passing through ALL rating PD anchors.

C1 PCHIP slopes (Fritsch-Butland), operating on log-odds, through the 20 rating
band centres (finite-band midpoints; AAA and D use their finite edge). Between
the D anchor and the AAA anchor the curve is the interpolation; at and above the
AAA anchor the PD is floored at the AAA PD (0.02%). Below the D anchor (Z-EM
-1.5, the D threshold) PD keeps rising along the logistic tail
PD = logistic(logit(PD_D) + b (z - Z_D)) with PD_D = 40% and slope b = pd_logit_b;
`logistic_tail` is the single definition, shared with the "rating_tail" method.
This is the primary Monte Carlo PD curve; it is not an empirically calibrated
default-frequency model.
"""
from functools import lru_cache
import math
import config
from config import Z_RATING_TABLE


def _sigmoid(x):
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def _end(h0, h1, d0, d1):
    m = ((2*h0+h1)*d0-h0*d1)/(h0+h1)
    if m*d0 <= 0: return 0.0
    if d0*d1 < 0 and abs(m) > 3*abs(d0): return 3*d0
    return m


@lru_cache(maxsize=1)
def anchors():
    rows=[]
    for lo,hi,r,p in Z_RATING_TABLE:
        z = lo if math.isfinite(lo) and not math.isfinite(hi) else hi if not math.isfinite(lo) else (lo+hi)/2
        rows.append((float(z), math.log(p/(1-p)),r,float(p)))
    rows.sort()
    x=tuple(r[0] for r in rows)
    y=tuple(r[1] for r in rows)
    h=[x[i+1]-x[i] for i in range(len(x)-1)]
    delta=[(y[i+1]-y[i])/h[i] for i in range(len(h))]
    d=[0.0]*len(x)
    d[0]=_end(h[0],h[1],delta[0],delta[1])
    d[-1]=_end(h[-1],h[-2],delta[-1],delta[-2])
    for i in range(1,len(x)-1):
        if delta[i-1]*delta[i]<=0:
            d[i]=0.0
        else:
            w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1]
            d[i]=(w1+w2)/(w1/delta[i-1]+w2/delta[i])
    return x,y,tuple(d)


def z_bounds():
    """(lowest, highest) anchor Z: the D-band and AAA-band anchors."""
    x, _, _ = anchors()
    return x[0], x[-1]


def logistic_tail(z, b, z_d, pd_d):
    """PD below the D threshold: logistic(logit(pd_d) + b (z - z_d)); b < 0, so PD
    rises as z falls. Used by both "rating_tail" and "rating_smooth"."""
    return _sigmoid(math.log(pd_d / (1.0 - pd_d)) + b * (z - z_d))


def anchored_pd(z, b=None):
    """Rating-anchored PD ("rating_smooth"). b is the tail slope below the D
    anchor (default: config pd_logit_b, as in shocks.pd_value)."""
    if b is None:
        b = config.DEFAULT_CASH_SETTINGS["pd_logit_b"]
    try:
        z=float(z)
    except (TypeError, ValueError, OverflowError):
        return float('nan')
    if not math.isfinite(z):
        return float('nan')
    x,y,d=anchors()
    if z<x[0]:       # below the D anchor: logistic tail from the D-band PD
        return logistic_tail(z, b, x[0], _sigmoid(y[0]))
    if z>=x[-1]:     # AAA floor: PD held at the AAA-band PD
        return _sigmoid(y[-1])
    import bisect
    i=bisect.bisect_right(x,z)-1
    h=x[i+1]-x[i]
    t=(z-x[i])/h
    v=(2*t**3-3*t*t+1)*y[i]+(t**3-2*t*t+t)*h*d[i]+(-2*t**3+3*t*t)*y[i+1]+(t**3-t*t)*h*d[i+1]
    return _sigmoid(v)
