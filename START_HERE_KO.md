# SOE Fiscal Risk Tool — 2026-10-27 수정본

자세한 내용은 `docs/CHANGES-2026-10-27.md`에 있습니다. 모델 공식·기본값은 바꾸지 않았고, `tests/`의 14개 검사가 모두 통과합니다.

- **첫 화면(Home) 새로 구성**: 구글처럼 단순한 화면. "What would you like to analyze?" 질문, 파일 업로드 상자 하나, 그리고 질문 카드 4개(어떤 SOE가 위험한가 / 예산에 얼마의 비용이 될 수 있나 / 충격이 오면 / 지금 조치가 필요한 것)에 현재 데이터의 답(지표)을 보여 주고, 누르면 해당 탭으로 이동합니다. 기존 Home 내용은 그대로 **About the tool and your data** 화면(`#view-about`)으로 옮겼습니다.
- **GDP 자동 입력**: World Bank 시리즈(현지통화 LCU `NY.GDP.MKTP.CN` / 미국 달러 `NY.GDP.MKTP.CD`)를 고르고 국가·연도를 선택하면 GDP가 자동으로 채워지고 바로 모델에 반영됩니다. 그다음 단위(Billions·Millions 등)를 고르면 표시만 바뀝니다. 재무제표와 통화가 다르면 채워만 두고 "Use it anyway"를 체크해야 반영됩니다. 데이터에 `Country` 열이 있으면 국가도 자동 선택됩니다. 세네갈이 항상 "Currency mismatch"로 나오던 버그도 고쳤습니다.
- **Expected Fiscal Cost 배치**: 왼쪽 Settings, 오른쪽에 막대그래프 두 개(EFC by SOE · Government backstop sensitivity)를 한 행에, 그 아래 LGD calibration, 맨 아래 EFC results.
- **Shock Scenarios 배치**: Distress score path · Expected fiscal cost path 행을 "what moved it" 그래프 두 개보다 위로 올렸습니다.

---

# SOE Fiscal Risk Tool — 2026-10-26 회의 반영본

자세한 변경 내역(회의 결정 → 변경 사항 대응표, 미완료 항목)은 `docs/CHANGES-meeting-2026-10-26.md`에 있습니다.

## 이번 반영본에서 달라진 점
- **탭 순서**: Home · How it works · KPI Dashboard · Distress Indicator · Expected Fiscal Cost · Shock Scenarios · Early Warning · Report(마지막). Government Support와 Assumptions(→ "Technical notes")는 탭 바에서 숨겼지만 삭제하지 않았습니다(링크 또는 `#view-gre`, `#view-assumptions`로 열림).
- **How it works (신규)**: 비전문가용 설명 화면. 기존 "How SOE Pilot Works" 설명서와 같은 디자인(지하철 노선 모양 진행 바, 스크롤하면 왼쪽 그림이 단계마다 다시 그려지는 효과)으로 만들었고, 숫자는 모두 툴에 올린 데이터로 실시간 계산됩니다. 11개 챕터: ① 왜 중요한가 ② **웹사이트 한눈에 보기**(7개 탭이 각각 어떤 질문에 답하는지, 어떤 순서로 쓰는지) ③ 재무제표 7개 숫자 ④ 건전성 지표 4개 ⑤ 부실 점수와 3개 구간(직접 움직여 보는 슬라이더 포함) ⑥ 등급과 부실 확률 ⑦ 기대 재정비용 ⑧ **충격이 전달되는 경로**(충격을 고르면 계정 지도에 단계별로 불이 들어옴) ⑨ 몬테카를로 ⑩ 포트폴리오 충격 순위와 모델 검증 ⑪ 조기경보와 보고서. 마지막에 탭별 "무엇을 설정하고 무엇은 기본값으로 둘지" 지도, 용어집. 다른 모든 탭 제목 아래에 "New to this tab? How to read it →" 링크가 있어 해당 설명으로 바로 갑니다.
- **Shock Scenarios 개편**: ① SOE와 기준연도 ② PD × EAD × LGD 설정(맨 위) ③ 충격: No shock / Standard stress / Custom shock(드롭다운으로 연료·환율·금리·매출·체납 중 하나 선택, 충격 크기 먼저 → 구조 요인) ④ 시간 범위(모든 충격 공통) ⑤ 고급 설정(접힘). 결과는 "충격 전달" 요약, 워터폴(브리지) 차트 2개, 경로 그래프 중심이고 표는 접어 두었습니다.
- **"All SOEs" 화면 삭제 → 두 화면으로 대체**: Portfolio macro shock(모든 SOE에 같은 매출 감소·금리 상승, 몬테카를로, 재정비용을 가장 많이 늘리는 SOE 순위)과 Model check(과거 연도에서 출발해 충격을 준 예측 경로와 실제 재무제표 점수를 비교하는 in-sample 검증).
- **버그 수정**: 체납(arrears) 충격이 크면 총자산이 음수가 되어 Distress → Safe로 튀던 문제. 상각액을 남은 비현금 유동자산 이내로 제한(Python·JS 동일). 신규 테스트 `tests/check_arrears_cap.py`.
- **Early Warning**: 트리거를 이슈별(전반 건전성, 지급능력·부채, 유동성, 스트레스 테스트, 추세, 재정 의존도)로 묶고 필터 추가, 트리거별 구체적 후속 조치, SOE별 Action plan(이전/다음). 신규 규칙: 이자보상배율 < 1, 유동비율 < 1.
- **Home**: 툴 설명 확대, 사용 순서 7단계, 적용 범위(비금융 SOE만, 한 국가·여러 SOE, 금융 SOE 제외 이유), 툴킷 4개 모듈(Early Warning Framework & Monitoring / Hidden Subsidies / Energy / PSO는 마지막).

## 아직 하지 않은 것
충격 크기의 과거 기준값(3–5년 중앙값·최소·최대), PDF 재무제표 자동 추출, 트리거 조치의 거버넌스팀 검증, PSO·금융 SOE 프레임워크.

---

# SOE Fiscal Risk Tool — 최종 통합본

최종 통합 기준: `the earlier Full Logistic / EFC Only model` 및 `SOE-main_waterfall_v2_final(2).zip`.

## 선택한 방식
- 화면은 기존의 Home, Report, KPI Dashboard, Distress Indicator, Expected Fiscal Cost, Shock Scenarios, Government Support, Early Warning, Assumptions를 유지합니다.
- **Monte Carlo = Rating-anchored PD(기본, AAA 하한 + D 아래 logistic tail) + 단일 Logistic(민감도 비교) + EFC only**. 각 경로/연도의 Z-EM에 대해 20개 등급 PD를 정확히 지나는 단조 곡선(logit-PCHIP)으로 PD를 계산하며, 4.9 이상에서는 0.02%로 하한 고정하고, Z-EM -1.5(D 임계값) 아래에서는 40%에서 출발해 기울기 b(`pd_logit_b`)의 logistic tail을 따라 PD가 계속 상승합니다(Z-EM -3에서 약 72%, -7에서 약 99%). 결정론적 탭은 기존 등급별 PD를 그대로 씁니다.
- 민감도용 단일 Logistic: `PD = 1 / (1 + exp(-(a+b Z)))`, a = -2.02276962, b = -0.89133626 (상한 없는 minimax 적합, 최대 오차 6.50%p). 기존 Rating PD에 맞추어 추정했으나 실제 부도 이력으로 검증한 것은 아닙니다. 상한을 둔 이전 적합(a = -2.18031828, b = -1.10613960)은 `python scripts/calibrate_pd.py --refit --caps`로 재현할 수 있습니다.
- EFC = PD × EAD × LGD. 실제 부도 사건 및 실현 손실은 추첨하지 않습니다. 채무상환 미이행만으로 MC PD를 100%로 덮어쓰지 않습니다.
- 일반 Single Scenario의 PD 방식은 기존처럼 Rating 중심으로 유지합니다. UI에 선택창이 노출되지만 Monte Carlo 화면에서는 숨겨 혼동을 줄입니다.
- 기존 Rating PD·Rating-anchored(기본)·단일 Logistic(민감도) 비교표 및 곡선은 **Shock Scenarios > Distribution (Monte Carlo) > Rating PD comparison and calibration details**에서 열어 볼 수 있습니다.
- 현금흐름에서 채무상환이 지연되어도 단일 시나리오에서 곧바로 '부도'로 처리하지 않는 것이 기본값입니다. 단일 시나리오 민감도 분석용 'Treat missed debt service as default' 옵션은 유지했습니다.

## 실행 방법
1. **바로 사용:** ZIP 내부의 `SOE-Fiscal-Risk-Final.html`을 더블 클릭하여 Chrome/Edge 등에서 엽니다. 입력 데이터 없이도 샘플 포트폴리오가 나타납니다.
2. **직접 데이터 사용:** 화면 상단의 **Upload data**로 기존 업로드 양식의 CSV/Excel을 선택합니다. ZIP 내 데이터는 실제 SENELEC 공식 재무자료가 아니라 예시용입니다.
3. **Streamlit:** 의존성 설치 후 프로젝트 폴더에서 `streamlit run Home.py`를 실행합니다.
4. **HTML 재생성:** 프로젝트 폴더에서 `python report.py --demo --out my_tool.html`을 실행합니다.

## 검증
- Python 및 JavaScript 문법 검사: 통과.
- Waterfall v2 회귀 검사: 14,228개 통과 (기본값 변경으로 이전의 '자동 부도' 테스트는 옵션을 명시하도록 수정함).
- Fuel path / cash-first 검사: 19,346개 통과.
- Python 및 JavaScript 핵심 MC 계산: 기본(Rating-anchored)과 Logistic 민감도 각각에서 PD 및 EFC 관계 확인, 실현 부도 칼럼 없음.
- Chromium 브라우저 smoke test: 화면 탐색, Monte Carlo 실행, PD 그래프, CSV 버튼, JS 오류 확인 통과.
- 전체 대규모 JS/Python parity 테스트는 실행 시간 제한으로 완료하지 못했으며, 모든 시나리오/브라우저에 대한 완전한 검증으로 해석해서는 안 됩니다.

## 참고
샘플 데이터가 표시하는 금액과 PD는 시연용이며 SENELEC 실측치가 아닙니다. 등급 PD 20개 자체가 예시용 표이며(CCC+와 CCC는 PD가 같아 그 사이 구간은 평평함), 단일 Logistic 민감도는 CCC+ 등 일부 등급에서 최대 6.50%p 오차가 있으므로 보정의 타당성을 추가로 검토하기 전에는 실증적으로 검증된 PD로 인용하지 않는 것이 좋습니다.
