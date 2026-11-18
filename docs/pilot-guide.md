# Pilot guide (human task — not done yet)

Goal: learn whether item claims plus a visible review make splits feel fairer, and whether recipient confirmation makes repayments clearer. Small pilots give design feedback, not proof of demand.

## Before

- Deploy to an HTTPS host with persistent storage (see runbooks). Install on your own iPhone via Safari → Share → *Add to Home Screen*.
- Recruit **one** consenting group for a low-value real purchase first; then 3–5 groups if it's understandable. Don't contact people automatically or ask for bank credentials.
- Explain up front: how the code works (anyone with it can join until the roster locks); one browser per person and the recovery key; payments happen outside the app and only the receiver confirms; **post-report corrections require a reason, resolved reports/disputes and everyone’s fresh approval**; confirmed money carries forward. Done stays read-only. Install on the Home Screen before joining, and explain organizer-assisted recovery’s trust trade-off.

## Scenarios

1. One equal shared receipt (e.g. snacks shared by all).
2. A dinner with solo meals, shared dishes and a service charge (someone skips the rice).
3. An event with two payers on separate receipts.

For each, agree a manual calculation beforehand and compare to the app to the centavo. Record policy disagreements (e.g. "service should be equal") separately from calculation errors.

## Observe (write down, don't infer)

| Measure | How |
| --- | --- |
| Allocation completion | members who answered every receipt / locked roster |
| Review friction | edits that reset approvals; lines people asked about |
| Explanation clarity | can each person explain their service charge and amount to pay? |
| Financial accuracy | app = agreed manual result? |
| Settlement progress | verified amount / total transfers; time to verified settlement |
| Repeat use | organizers who start a second real event (exclude demos) |

Template per session: date · group size · scenario · completion · issues seen (quote people) · bugs · changes to make. Store notes without names, QR codes or payment details.

## After

Triage money/access bugs immediately. Update `docs/decisions.md` with agreed requirement changes and `docs/case-study-template.md` with real, anonymised findings only.
