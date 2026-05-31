import requests
import json
import sys

API_URL = "http://localhost:3000/api/analyze"

def run_eval():
    with open("eval/golden_examples.json", "r") as f:
        examples = json.load(f)
    
    print("Starting Eval...")
    passed = 0
    failed = 0

    for ex in examples:
        print(f"\nRunning: {ex['name']} ({ex['id']})")
        try:
            res = requests.post(API_URL, json={"message": ex["input"], "history": []})
            if res.status_code != 200:
                print(f"  ❌ Failed: HTTP {res.status_code}")
                failed += 1
                continue
            
            text = res.text
            ok = check(text, ex.get("expected", {}))
            
            if ok:
                print("  ✅ Passed")
                passed += 1
            else:
                print("  ❌ Failed: Expectations not met")
                failed += 1
                
        except Exception as e:
            print(f"  ❌ Error: {e}")
            failed += 1

    print(f"\nEval Complete: {passed} passed, {failed} failed")

def check(text, expected):
    if "contains" in expected:
        for term in expected["contains"]:
            if term not in text:
                print(f"    Missing: {term}")
                return False
    if "not_contains" in expected:
        for term in expected["not_contains"]:
            if term in text:
                print(f"    Unexpected: {term}")
                return False
    return True

if __name__ == "__main__":
    run_eval()
