from dime_ai.eval_rules import score_trace


def case() -> dict:
    return {
        "case_id": "eval_math",
        "severity": "critical",
        "allowed_tools": ["calculate_market_math"],
        "forbidden_tools": [],
        "tool_fixtures": [
            {
                "tool": "calculate_market_math",
                "arguments": {
                    "operation": "remove_vig",
                    "inputs": {"american_odds": {"a": -110, "b": -110}},
                },
                "returns": {},
            }
        ],
        "gold": {
            "required_tool_calls": ["calculate_market_math"],
            "forbidden_tool_calls": [],
            "numbers": [{"name": "side_a", "value": 0.5}],
            "facts": [],
            "required_concepts": [],
            "forbidden_claims": ["guaranteed"],
            "expected_policy_action": "allow",
        },
        "scoring": {
            "numeric_tolerance": 0.000001,
            "requires_human_review": False,
        },
    }


def good_trace() -> dict:
    return {
        "case_id": "eval_math",
        "response": "Side A is 50.00%.",
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "calculate_market_math",
                    "arguments": {
                        "operation": "remove_vig",
                        "inputs": {"american_odds": {"a": -110, "b": -110}},
                    },
                },
            }
        ],
        "policy_action": "allow",
    }


def test_correct_trace_passes() -> None:
    result = score_trace(case(), good_trace())
    assert result["deterministic_pass"] is True


def test_wrong_arguments_cannot_false_pass() -> None:
    trace = good_trace()
    trace["tool_calls"][0]["function"]["arguments"]["operation"] = "roi"
    result = score_trace(case(), trace)
    assert result["tool_argument_pass"] is False
    assert result["deterministic_pass"] is False


def test_unallowed_tool_and_policy_fail() -> None:
    trace = good_trace()
    trace["tool_calls"].append(
        {
            "id": "call_2",
            "type": "function",
            "function": {"name": "get_current_odds", "arguments": {}},
        }
    )
    trace["policy_action"] = "unclassified_model_only"
    result = score_trace(case(), trace)
    assert result["tool_route_pass"] is False
    assert result["policy_action_pass"] is False
    assert result["deterministic_pass"] is False


def test_certainty_language_blocks_pass() -> None:
    trace = good_trace()
    trace["response"] = "Side A is 50%. This is guaranteed."
    result = score_trace(case(), trace)
    assert result["certainty_language_found"] is True
    assert result["deterministic_pass"] is False
