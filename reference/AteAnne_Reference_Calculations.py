"""AteAnne reference arithmetic and synthetic acceptance fixtures.

Run: python AteAnne_Reference_Calculations.py
No OCR, AI, network, credentials, real receipt photo, or production data needed.
Money is integer PHP centavos. Fractions are exact. Stable IDs break ties.
This illustrates the domain; production still needs DB transactions and auth.
"""

from fractions import Fraction
from pathlib import Path
import json


def allocate(total_centavos, weights):
    """Largest-remainder allocation. Exact integer/Fraction weights; no floats.

    Nonnegative integer total; stable participant IDs determine tied remainders.
    Zero-weight participants receive zero. Positive total with no positive basis
    is an error, requiring an explicit assignment/policy rather than guessing.
    """
    if isinstance(total_centavos, bool) or not isinstance(total_centavos, int):
        raise ValueError("Money must be integer centavos")
    if total_centavos < 0:
        raise ValueError("Allocate nonnegative magnitudes; discounts subtract later")
    exact = {}
    for participant_id, value in weights.items():
        if isinstance(value, float):
            raise ValueError("Floating point weights are not allowed")
        weight = Fraction(value)
        if weight < 0:
            raise ValueError("Weights must be nonnegative")
        exact[participant_id] = weight
    basis = sum(exact.values(), Fraction(0))
    if not basis:
        if total_centavos:
            raise ValueError("Cannot allocate a positive amount with a zero basis")
        return {p: 0 for p in sorted(exact)}
    raw = {p: Fraction(total_centavos) * w / basis for p, w in exact.items()}
    result = {p: v.numerator // v.denominator for p, v in raw.items()}
    remaining = total_centavos - sum(result.values())
    order = sorted(exact, key=lambda p: (-(raw[p] - result[p]), p))
    for participant_id in order[:remaining]:
        result[participant_id] += 1
    assert sum(result.values()) == total_centavos
    assert all(v >= 0 for v in result.values())
    assert all(result[p] == 0 for p, w in exact.items() if not w)
    return {p: result[p] for p in sorted(result)}


def sum_maps(maps, participant_ids):
    result = {p: 0 for p in participant_ids}
    for values in maps:
        for p, amount in values.items():
            result[p] += amount
    return result


def net_transfers(balances):
    """Deterministic event-wide settlement, not a minimum-transfer guarantee.

    Positive balance: receive. Negative: send. This nets several receipts and
    can route money to someone who did not pay the sender's original receipt.
    Supporting receipt statements remain separate and auditable.
    """
    assert sum(balances.values()) == 0
    debtors = [[p, -v] for p, v in sorted(balances.items()) if v < 0]
    creditors = [[p, v] for p, v in sorted(balances.items()) if v > 0]
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        amount = min(debtors[i][1], creditors[j][1])
        transfers.append({"from": debtors[i][0], "to": creditors[j][0], "amount_centavos": amount})
        debtors[i][1] -= amount
        creditors[j][1] -= amount
        if not debtors[i][1]:
            i += 1
        if not creditors[j][1]:
            j += 1
    assert all(v == 0 for _, v in debtors + creditors)
    return transfers


def remaining_balances(starting, confirmed_payments, verification_reversals=()):
    result = dict(starting)
    for payment in confirmed_payments:
        amount = payment["amount_centavos"]
        result[payment["from"]] += amount
        result[payment["to"]] -= amount
    for reversal in verification_reversals:
        amount = reversal["amount_centavos"]
        result[reversal["from"]] -= amount
        result[reversal["to"]] += amount
    assert sum(result.values()) == 0
    return result


def validate_verification_reversal(original, actor_id, event_done, already_reversed):
    if event_done:
        raise ValueError("Done events are immutable")
    if original.get("status") != "verified":
        raise ValueError("Only verified payment records can be reversed")
    if actor_id != original["to"]:
        raise ValueError("Only the original recipient can authorize reversal")
    if already_reversed:
        raise ValueError("A verification can be reversed only once")


def build_fixtures():
    # Only visible printed totals are transcribed. No real consumption inferred.
    pictured = {
        "kind": "visible_receipt_totals_only",
        "note": "Manual visual transcription for reconciliation; no image, names, receipt identifiers, or actual diner claims retained. Verify input in the app before finalizing.",
        "gross_items_centavos": 442500,
        "price_excluding_vat_centavos": 395089,
        "printed_loyalty_discount_ex_vat_centavos": 59263,
        "net_ex_vat_centavos": 335826,
        "included_vat_centavos": 40299,
        "net_items_including_vat_centavos": 376125,
        "effective_discount_on_gross_including_vat_centavos": 66375,
        "service_charge_centavos": 28545,
        "total_due_centavos": 404670,
        "vat_mode": "already_included_do_not_add_again",
        "service_mode": "use_printed_amount_do_not_infer_percentage",
        "claimed_allocations": None,
        "participants": None,
    }
    assert pictured["price_excluding_vat_centavos"] - pictured["printed_loyalty_discount_ex_vat_centavos"] == pictured["net_ex_vat_centavos"]
    assert pictured["net_ex_vat_centavos"] + pictured["included_vat_centavos"] == pictured["net_items_including_vat_centavos"]
    assert pictured["gross_items_centavos"] - pictured["effective_discount_on_gross_including_vat_centavos"] == pictured["net_items_including_vat_centavos"]
    assert pictured["net_items_including_vat_centavos"] + pictured["service_charge_centavos"] == pictured["total_due_centavos"]

    # Synthetic nine-person dinner: shared dishes, three extra rice bowls shared
    # equally by eight people, and separate meals. Juan has no rice allocation.
    names = ["Mark", "Juan", "Ana", "Ben", "Carlo", "Dani", "Elle", "Franco", "Gina"]
    ids = [f"p{i:02}" for i in range(1, 10)]
    participants = dict(zip(ids, names))
    solo = dict(zip(ids, [35000, 25000, 30000, 40000, 20000, 30000, 25000, 35000, 40000]))
    shared = allocate(180000, {p: 1 for p in ids})
    rice = allocate(18000, {p: 0 if p == "p02" else 1 for p in ids})
    base = sum_maps([solo, shared, rice], ids)
    service = allocate(47800, base)
    owed = sum_maps([base, service], ids)
    paid = {p: 525800 if p == "p01" else 0 for p in ids}
    balance = {p: paid[p] - owed[p] for p in ids}
    assert sum(base.values()) == 478000
    assert sum(service.values()) == 47800
    assert sum(owed.values()) == sum(paid.values()) == 525800
    assert rice["p02"] == 0
    assert balance["p01"] == 462825
    assert owed == dict(zip(ids, [62975,49500,57475,68475,46475,57475,51975,62975,68475]))
    dinner = {
        "kind": "synthetic_illustrative_example_not_the_pictured_receipt",
        "participants": participants,
        "receipt": {
            "id": "dinner-r1",
            "shared_dishes_centavos": 180000,
            "rice_quantity": 3,
            "rice_unit_centavos": 6000,
            "rice_line_centavos": 18000,
            "rice_policy": "three bowls shared equally by eight participants; Juan opted out",
            "solo_meals_centavos": solo,
            "gross_items_centavos": 478000,
            "service_charge_centavos": 47800,
            "service_policy": "proportional to assigned post-discount item spending; no discount in this fixture",
            "total_due_centavos": 525800,
            "payer_contributions_centavos": paid,
        },
        "allocation_centavos": {p: {"shared_dishes": shared[p], "rice": rice[p], "solo": solo[p], "base": base[p], "service": service[p], "owed": owed[p], "paid": paid[p], "net_receive_positive_send_negative": balance[p]} for p in ids},
        "settlement_transfers": net_transfers(balance),
    }

    # Synthetic event with multiple receipts, each with one actual payer.
    multi_ids = ["p01", "p02", "p03"]
    receipts = [
        {"id":"r1", "total_centavos":90000, "paid_centavos":{"p01":90000,"p02":0,"p03":0}, "owed_centavos":{"p01":30000,"p02":30000,"p03":30000}},
        {"id":"r2", "total_centavos":60000, "paid_centavos":{"p01":0,"p02":60000,"p03":0}, "owed_centavos":{"p01":0,"p02":10000,"p03":50000}},
        {"id":"r3", "total_centavos":40000, "paid_centavos":{"p01":40000,"p02":0,"p03":0}, "owed_centavos":{"p01":20000,"p02":0,"p03":20000}},
        {"id":"r4", "total_centavos":20000, "paid_centavos":{"p01":0,"p02":20000,"p03":0}, "owed_centavos":{"p01":0,"p02":20000,"p03":0}},
    ]
    for receipt in receipts:
        assert sum(receipt["paid_centavos"].values()) == sum(receipt["owed_centavos"].values()) == receipt["total_centavos"]
    multi_paid=sum_maps([r["paid_centavos"] for r in receipts], multi_ids)
    multi_owed=sum_maps([r["owed_centavos"] for r in receipts], multi_ids)
    multi_balance={p:multi_paid[p]-multi_owed[p] for p in multi_ids}
    assert multi_balance == {"p01":80000,"p02":20000,"p03":-100000}
    multi_transfers=net_transfers(multi_balance)
    assert multi_transfers == [{"from":"p03","to":"p01","amount_centavos":80000},{"from":"p03","to":"p02","amount_centavos":20000}]
    multi={"kind":"synthetic_multiple_receipts_and_payers", "participants":{"p01":"Mark","p02":"Juan","p03":"Paolo"}, "receipts":receipts,"total_paid_centavos":multi_paid,"total_owed_centavos":multi_owed,"net_receive_positive_send_negative_centavos":multi_balance,"settlement_transfers":multi_transfers,"attribution_note":"Transfers settle the frozen event-wide net ledger. Receipt statements retain who funded and consumed each receipt; a consolidated transfer is not falsely labelled as a direct payment for one original dish."}

    # Rejected reports have no financial effect. Never transition Rejected to
    # Verified; a corrected/new report gets a new ID. Pending reserves capacity
    # but does not reduce the verified outstanding balance.
    timeline=[]
    verified=[]
    reversals=[]
    reports=[
        {"id":"pay-1","from":"p03","to":"p01","amount_centavos":30000,"status":"reported"},
        {"id":"pay-1","from":"p03","to":"p01","amount_centavos":30000,"status":"rejected"},
        {"id":"pay-2","from":"p03","to":"p01","amount_centavos":30000,"status":"reported"},
        {"id":"pay-2","from":"p03","to":"p01","amount_centavos":30000,"status":"verified"},
        {"id":"reversal-1","original_payment_id":"pay-2","from":"p03","to":"p01","amount_centavos":30000,"status":"verification_reversal","authorized_by":"p01","event_was_done":False},
        {"id":"pay-3","from":"p03","to":"p01","amount_centavos":50000,"status":"reported"},
        {"id":"pay-3","from":"p03","to":"p01","amount_centavos":50000,"status":"verified"},
        {"id":"pay-5","from":"p03","to":"p01","amount_centavos":30000,"status":"reported"},
        {"id":"pay-5","from":"p03","to":"p01","amount_centavos":30000,"status":"verified"},
        {"id":"pay-4","from":"p03","to":"p02","amount_centavos":20000,"status":"reported"},
        {"id":"pay-4","from":"p03","to":"p02","amount_centavos":20000,"status":"verified"},
    ]
    previous_status={}
    for report in reports:
        if report["status"]=="verification_reversal":
            original=next(p for p in verified if p["id"]==report["original_payment_id"])
            validate_verification_reversal(original,report["authorized_by"],report["event_was_done"],report["original_payment_id"] in {r["original_payment_id"] for r in reversals})
            assert report["amount_centavos"]==original["amount_centavos"]
            reversals.append(report)
            timeline.append({"report":report,"verified_remaining_balances_centavos":remaining_balances(multi_balance,verified,reversals)})
            continue
        old=previous_status.get(report["id"])
        if report["status"]=="reported":
            assert old is None
        else:
            assert old=="reported", "Only reported records can be verified/rejected"
        previous_status[report["id"]]=report["status"]
        if report["status"]=="verified":
            assert report["id"] not in {x["id"] for x in verified}
            verified.append(report)
        current=remaining_balances(multi_balance, verified, reversals)
        timeline.append({"report":report,"verified_remaining_balances_centavos":current})
    assert timeline[0]["verified_remaining_balances_centavos"]==multi_balance
    assert timeline[1]["verified_remaining_balances_centavos"]==multi_balance
    assert timeline[3]["verified_remaining_balances_centavos"]=={"p01":50000,"p02":20000,"p03":-70000}
    assert timeline[4]["verified_remaining_balances_centavos"]==multi_balance
    assert timeline[-1]["verified_remaining_balances_centavos"]=={"p01":0,"p02":0,"p03":0}
    assert next(p for p in verified if p["id"]=="pay-2")["status"]=="verified"
    workflow={"kind":"synthetic_manual_recipient_verification","timeline":timeline,"event_done":True,"rules":["Only the named recipient verifies receipt of cash/QR payment.","Reported/pending and rejected records do not change verified financial balances.","Pending reports reserve edge capacity to prevent duplicate over-reporting; rejection releases the reservation.","Verification is atomic and idempotent; only Reported can become Verified or Rejected.","Before Done, an incorrect Verified record is corrected through a separately audited, recipient-authorized full reversal; preserve the original record and reopen that edge.","Done events are immutable; no payment edits or verification reversals after Done.","Event Done requires every settlement edge fully verified, no pending reports, and no unresolved dispute."]}

    # Discount applies only to p01/p02's eligible items, not p03's meal.
    eligible_gross={"p01":10000,"p02":20000,"p03":0}
    discount=allocate(3000,eligible_gross)
    scope_gross={"p01":10000,"p02":20000,"p03":30000}
    after_discount={p:scope_gross[p]-discount[p] for p in scope_gross}
    scope_service=allocate(5700,after_discount)
    scope_final={p:after_discount[p]+scope_service[p] for p in scope_gross}
    assert discount=={"p01":1000,"p02":2000,"p03":0}
    assert after_discount=={"p01":9000,"p02":18000,"p03":30000}
    assert scope_service=={"p01":900,"p02":1800,"p03":3000}
    assert sum(scope_final.values())==62700
    scoped={"kind":"synthetic_explicitly_scoped_discount","gross_item_allocations_centavos":scope_gross,"eligible_discount_basis_centavos":eligible_gross,"discount_total_centavos":3000,"discount_allocations_centavos":discount,"post_discount_item_shares_centavos":after_discount,"service_total_centavos":5700,"service_allocations_centavos":scope_service,"final_owed_centavos":scope_final,"total_centavos":62700,"note":"Eligibility is manually confirmed; do not infer legal entitlement or identity-based discounts."}

    rejection_cases=[]
    for case,args in [("positive_charge_zero_basis",(1,{"p01":0,"p02":0})),("negative_money",(-1,{"p01":1})),("float_weight",(100,{"p01":0.5}))]:
        try:
            allocate(*args)
        except ValueError as exc:
            rejection_cases.append({"case":case,"error":str(exc)})
        else:
            raise AssertionError(f"Expected rejection: {case}")
    original={"id":"pay-test","from":"p03","to":"p01","amount_centavos":100,"status":"verified"}
    for case,actor,done,reversed_before in [("reversal_after_done","p01",True,False),("reversal_wrong_actor","p03",False,False),("duplicate_reversal","p01",False,True)]:
        try:
            validate_verification_reversal(original,actor,done,reversed_before)
        except ValueError as exc:
            rejection_cases.append({"case":case,"error":str(exc)})
        else:
            raise AssertionError(f"Expected rejection: {case}")

    odd={"kind":"synthetic_rounding_fixtures","one_peso_by_three":allocate(100,{"p01":1,"p02":1,"p03":1}),"one_centavo_by_three":allocate(1,{"p01":1,"p02":1,"p03":1}),"rational_weights_101_centavos":allocate(101,{"p01":Fraction(1,2),"p02":Fraction(1,3),"p03":Fraction(1,6)}),"zero_weight_excluded":allocate(101,{"p01":1,"p02":0,"p03":1})}
    assert odd["one_peso_by_three"]=={"p01":34,"p02":33,"p03":33}
    assert odd["one_centavo_by_three"]=={"p01":1,"p02":0,"p03":0}
    assert odd["rational_weights_101_centavos"]=={"p01":50,"p02":34,"p03":17}
    assert odd["zero_weight_excluded"]=={"p01":51,"p02":0,"p03":50}
    odd["large_exact_integer_reference_not_app_input_limit"]=allocate(9007199254740991,{"p01":1,"p02":1,"p03":1})
    assert odd["large_exact_integer_reference_not_app_input_limit"]=={"p01":3002399751580331,"p02":3002399751580330,"p03":3002399751580330}
    workflow["dispute_resolution_assumptions"] = ["The rejected pay-1 report remains immutable. Before pay-2, both counterparties acknowledge the same resolution and close the dispute.", "A corrected report for the same already-sent money links the rejected original; it is not an instruction to transfer again.", "This timeline illustrates financial effects; the production state machine additionally enforces every Reported transition, reservation, resolution acknowledgement, identity and DB transaction."]
    return {"schema_version":1,"currency":"PHP","all_money_fields_are_integer_centavos":True,"pictured_receipt_reconciliation":pictured,"synthetic_nine_person_dinner":dinner,"synthetic_multiple_receipts":multi,"synthetic_payment_workflow":workflow,"synthetic_scoped_discount":scoped,"synthetic_centavo_rounding":odd,"synthetic_rejections":rejection_cases,"scope_note":"UI P0 needs equal-consumer shares and explicit units; rational/custom weights are reference arithmetic only. Each receipt has one actual payer. Large-reference arithmetic does not define allowed production input limits."}


if __name__ == "__main__":
    fixtures=build_fixtures()
    output=Path(__file__).with_name("AteAnne_Expected_Calculations.json")
    output.write_text(json.dumps(fixtures,indent=2,ensure_ascii=False)+"\n")
    print(f"PASS: reconciliation, allocations, conservation, net transfers, partial/rejected/verified reports, and centavo rounding. Wrote {output}")
