---
id: cmo-reporting-standard
title: CMO Reporting & Experiment Standard
version: 2.2.0
owner: Chief Marketing Office
authority: L1-policy
classification: internal
effective_at: 2026-03-15
review_at: 2026-09-15
---

# CMO Reporting & Experiment Standard

## 1. Reporting window

The default window is the **last 30 complete days**, compared with the preceding 30 days. The report must state the exact date range, data freshness, and any missing days.

## 2. Metric definitions

| Metric | Definition |
|---|---|
| Qualified leads | leads meeting the published qualification checklist |
| Conversion rate | won deals ÷ qualified leads in the same cohort |
| Median cycle time | median days from qualified lead to close |
| Partner activation | partners with at least one qualified referral in the window |
| Revenue | recognised revenue, not bookings or pipeline |

Metrics are computed by SQL or analysis code before interpretation. The model may explain the result but may not recompute or invent a number.

## 3. Sample-size guardrail

Do not present a segment trend as a finding when the segment has fewer than 30 qualified leads or fewer than 10 won deals in the window. Label it **insufficient sample** and show the count.

## 4. Facts versus hypotheses

Every insight carries a label:

- **MEASURED** — directly computed from the dataset.
- **HYPOTHESIS** — a plausible explanation that requires testing.
- **INSUFFICIENT** — data does not support a conclusion.

The interface must never render a hypothesis with the visual authority of a measured fact.

## 5. Causal language

Correlation is not causation. Do not use "caused by", "drove", or "resulted in" unless an experiment or a defensible identification strategy supports it. Prefer "coincided with", "is consistent with", or "may be explained by".

## 6. Experiment design

A proposed experiment states: hypothesis, primary metric, guardrail metric, segment, minimum sample, duration, and decision rule. Experiments run for a pre-registered period and are evaluated against the baseline.

## 7. Data limitations

Report missing channels, attribution gaps, delayed reconciliation, and any manual adjustment. If two sources disagree, show both and route the discrepancy to the data owner.
