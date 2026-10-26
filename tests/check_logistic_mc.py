"""Regression checks of the single-logistic PD (the Monte Carlo sensitivity, mc_pd_method=logistic)."""
import sys, pathlib, numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import config, shocks
a=config.DEFAULT_CASH_SETTINGS['pd_logit_a'];b=config.DEFAULT_CASH_SETTINGS['pd_logit_b']
assert b < 0
z=np.linspace(-6,5,501)
ps=[shocks.pd_value(float(v),config.z_rating(float(v)),False,{'pd_method':'logistic','pd_logit_a':a,'pd_logit_b':b}) for v in z]
assert all(0<k<1 for k in ps) and all(ps[i] > ps[i+1] for i in range(len(ps)-1))
assert ps[0]>0.4
assert shocks.pd_value(-3,'D',False,{'pd_method':'rating'})==0.4
assert shocks.pd_value(-3,'D',True,{'pd_method':'logistic','pd_logit_a':a,'pd_logit_b':b})==1.0  # deterministic only
assert np.isclose(shocks.pd_value(-3,'D',True,{'pd_method':'logistic','pd_logit_a':a,'pd_logit_b':b,'pd_override_on_missed_service':False}),shocks.pd_value(-3,'D',False,{'pd_method':'logistic','pd_logit_a':a,'pd_logit_b':b}))
print('Logistic monotonicity, >40% distress PD, legacy rating and MC override checks: PASS')
