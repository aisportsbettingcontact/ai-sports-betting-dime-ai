from decimal import Decimal

import pytest

from dime_ai.market_math import (
    InvalidMarket,
    InvalidOdds,
    InvalidProbability,
    InvalidSettlement,
    american_to_decimal,
    american_to_implied_probability,
    decimal_to_american,
    decimal_to_implied_probability,
    expected_profit_per_unit,
    line_delta,
    market_hold,
    probability_clv,
    remove_vig,
    remove_vig_from_american,
    roi,
    settled_profit,
)


def test_positive_american_odds() -> None:
    assert american_to_decimal(150) == Decimal("2.5")
    assert american_to_implied_probability(150) == Decimal("0.4")
    assert decimal_to_american("2.5") == Decimal("150")


def test_negative_american_odds() -> None:
    assert american_to_decimal(-200) == Decimal("1.5")
    expected = Decimal(2) / Decimal(3)
    assert abs(american_to_implied_probability(-200) - expected) < Decimal("1e-27")


def test_even_two_way_no_vig_and_hold() -> None:
    raw = {
        "a": american_to_implied_probability(-110),
        "b": american_to_implied_probability(-110),
    }
    no_vig = remove_vig(raw)
    assert no_vig == {"a": Decimal("0.5"), "b": Decimal("0.5")}
    assert abs(market_hold(raw) - Decimal(1) / Decimal(21)) < Decimal("1e-27")
    assert remove_vig_from_american({"a": -110, "b": -110}) == {
        "a": Decimal("0.5"),
        "b": Decimal("0.5"),
    }


def test_three_way_no_vig() -> None:
    raw = {
        "home": decimal_to_implied_probability("2.0"),
        "draw": decimal_to_implied_probability("3.2"),
        "away": decimal_to_implied_probability("4.0"),
    }
    no_vig = remove_vig(raw)
    assert abs(no_vig["home"] - Decimal(8) / Decimal(17)) < Decimal("1e-27")
    assert abs(no_vig["draw"] - Decimal(5) / Decimal(17)) < Decimal("1e-27")
    assert abs(no_vig["away"] - Decimal(4) / Decimal(17)) < Decimal("1e-27")
    assert sum(no_vig.values()) == Decimal(1)


def test_expected_profit_per_unit() -> None:
    result = expected_profit_per_unit("0.55", american_to_decimal(-110))
    assert result == Decimal("0.05")
    fair_price = Decimal(1) / Decimal("0.55")
    assert abs(expected_profit_per_unit("0.55", fair_price)) < Decimal("1e-27")


@pytest.mark.parametrize(
    ("result", "expected"),
    [("win", Decimal(3)), ("loss", Decimal(-2)), ("push", Decimal(0)), ("void", Decimal(0))],
)
def test_settlement(result: str, expected: Decimal) -> None:
    assert settled_profit(Decimal(2), Decimal("2.5"), result) == expected


def test_roi() -> None:
    assert abs(roi([1, -1, "0.5"], [1, 1, 1]) - Decimal(1) / Decimal(6)) < Decimal("1e-27")


def test_probability_space_clv() -> None:
    clv = probability_clv({"a": -110, "b": -110}, {"a": -130, "b": 110}, "a")
    expected = Decimal(273) / Decimal(503) - Decimal("0.5")
    assert abs(clv - expected) < Decimal("1e-27")
    assert probability_clv({"a": -110, "b": -110}, {"a": -110, "b": -110}, "a") == 0


@pytest.mark.parametrize("odds", [-99, 0, 99])
def test_invalid_american_odds(odds: int) -> None:
    with pytest.raises(InvalidOdds):
        american_to_decimal(odds)


@pytest.mark.parametrize("odds", ["1", "0.9", "0"])
def test_invalid_decimal_odds(odds: str) -> None:
    with pytest.raises(InvalidOdds):
        decimal_to_implied_probability(odds)


@pytest.mark.parametrize("probability", ["-0.01", "1.01"])
def test_invalid_probability(probability: str) -> None:
    with pytest.raises(InvalidProbability):
        expected_profit_per_unit(probability, "2")


def test_invalid_markets_and_settlement() -> None:
    with pytest.raises(InvalidMarket):
        remove_vig({"only": Decimal("0.5")})
    with pytest.raises(InvalidMarket):
        remove_vig({"a": Decimal("0.5"), "b": Decimal("0")})
    with pytest.raises(InvalidMarket):
        remove_vig({"a": Decimal("1.1"), "b": Decimal("0.5")})
    with pytest.raises(InvalidSettlement):
        roi([1], [0])
    with pytest.raises(InvalidSettlement):
        settled_profit(-1, 2, "win")
    with pytest.raises(ValueError):
        american_to_decimal(True)
    with pytest.raises(ValueError):
        expected_profit_per_unit("not-a-number", "2")


def test_line_delta() -> None:
    assert line_delta("-3.5", "-2.5") == Decimal("1.0")


def test_normalization_order_and_scale_invariance() -> None:
    first = remove_vig({"a": "0.4", "b": "0.3", "c": "0.2"})
    scaled = remove_vig({"c": "0.4", "a": "0.8", "b": "0.6"})
    assert first == scaled
    assert list(remove_vig({"b": "0.3", "a": "0.4"})) == ["b", "a"]
