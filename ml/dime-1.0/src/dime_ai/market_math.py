"""Deterministic sportsbook mathematics.

All public functions use Decimal and avoid internal rounding. Presentation
rounding belongs in the application layer.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal, InvalidOperation, localcontext
from typing import Literal


class InvalidOdds(ValueError):
    """Raised when odds are outside their valid domain."""


class InvalidProbability(ValueError):
    """Raised when a probability is outside [0, 1]."""


class InvalidMarket(ValueError):
    """Raised when a market cannot be normalized or compared."""


class InvalidSettlement(ValueError):
    """Raised when settlement inputs are invalid."""


MATH_PRECISION = 80


def _decimal(value: Decimal | int | str) -> Decimal:
    if isinstance(value, bool):
        raise ValueError("Boolean values are not valid numeric inputs.")
    try:
        if isinstance(value, Decimal):
            result = value
        else:
            result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Invalid decimal value: {value!r}") from exc
    if not result.is_finite():
        raise ValueError("Values must be finite.")
    return result


def _validate_american(odds: int) -> int:
    if isinstance(odds, bool) or not isinstance(odds, int):
        raise InvalidOdds("American odds must be an integer.")
    if -100 < odds < 100:
        raise InvalidOdds("American odds must be <= -100 or >= +100.")
    return odds


def _validate_decimal_odds(decimal_odds: Decimal | int | str) -> Decimal:
    value = _decimal(decimal_odds)
    if value <= 1:
        raise InvalidOdds("Decimal odds must be greater than 1.")
    return value


def _validate_probability(probability: Decimal | int | str) -> Decimal:
    value = _decimal(probability)
    if value < 0 or value > 1:
        raise InvalidProbability("Probability must be between 0 and 1.")
    return value


def american_to_decimal(odds: int) -> Decimal:
    """Convert valid American odds to decimal odds."""

    odds = _validate_american(odds)
    with localcontext() as context:
        context.prec = MATH_PRECISION
        if odds > 0:
            return Decimal(1) + Decimal(odds) / Decimal(100)
        return Decimal(1) + Decimal(100) / Decimal(abs(odds))


def american_to_implied_probability(odds: int) -> Decimal:
    """Return the raw, vig-inclusive implied probability."""

    with localcontext() as context:
        context.prec = MATH_PRECISION
        return Decimal(1) / american_to_decimal(odds)


def decimal_to_american(decimal_odds: Decimal | int | str) -> Decimal:
    """Convert decimal odds to an exact Decimal American price."""

    value = _validate_decimal_odds(decimal_odds)
    with localcontext() as context:
        context.prec = MATH_PRECISION
        if value >= 2:
            return (value - 1) * Decimal(100)
        return -Decimal(100) / (value - 1)


def decimal_to_implied_probability(decimal_odds: Decimal | int | str) -> Decimal:
    """Return implied probability from decimal odds."""

    with localcontext() as context:
        context.prec = MATH_PRECISION
        return Decimal(1) / _validate_decimal_odds(decimal_odds)


def remove_vig(raw_probabilities: Mapping[str, Decimal | int | str]) -> dict[str, Decimal]:
    """Normalize two or more positive raw implied probabilities to sum to one."""

    if len(raw_probabilities) < 2:
        raise InvalidMarket("A market must contain at least two selections.")
    converted = {key: _decimal(value) for key, value in raw_probabilities.items()}
    if any(value <= 0 or value > 1 for value in converted.values()):
        raise InvalidMarket("Every raw implied probability must be in (0, 1].")
    precision = max(len(value.as_tuple().digits) for value in converted.values()) * 2 + 20
    with localcontext() as context:
        context.prec = max(MATH_PRECISION, precision)
        total = sum(converted.values(), Decimal(0))
        return {key: value / total for key, value in converted.items()}


def remove_vig_from_american(american_odds: Mapping[str, int]) -> dict[str, Decimal]:
    """Convert an American-odds market to no-vig probabilities."""

    raw = {
        selection: american_to_implied_probability(odds)
        for selection, odds in american_odds.items()
    }
    return remove_vig(raw)


def market_hold(raw_probabilities: Mapping[str, Decimal | int | str]) -> Decimal:
    """Return sum(raw probabilities) - 1."""

    if len(raw_probabilities) < 2:
        raise InvalidMarket("A market must contain at least two selections.")
    converted = [_decimal(value) for value in raw_probabilities.values()]
    if any(value <= 0 or value > 1 for value in converted):
        raise InvalidMarket("Every raw implied probability must be in (0, 1].")
    precision = max(len(value.as_tuple().digits) for value in converted) * 2 + 20
    with localcontext() as context:
        context.prec = max(MATH_PRECISION, precision)
        return sum(converted, Decimal(0)) - Decimal(1)


def expected_profit_per_unit(
    probability: Decimal | int | str,
    decimal_odds: Decimal | int | str,
) -> Decimal:
    """Return expected net profit for one unit staked."""

    p = _validate_probability(probability)
    price = _validate_decimal_odds(decimal_odds)
    with localcontext() as context:
        context.prec = MATH_PRECISION
        return p * (price - 1) - (1 - p)


def settled_profit(
    stake: Decimal | int | str,
    decimal_odds: Decimal | int | str,
    result: Literal["win", "loss", "push", "void"],
) -> Decimal:
    """Return net settled profit, excluding the returned stake."""

    stake_value = _decimal(stake)
    if stake_value < 0:
        raise InvalidSettlement("Stake must be nonnegative.")
    price = _validate_decimal_odds(decimal_odds)
    if result == "win":
        with localcontext() as context:
            context.prec = MATH_PRECISION
            return stake_value * (price - 1)
    if result == "loss":
        return -stake_value
    if result in {"push", "void"}:
        return Decimal(0)
    raise InvalidSettlement(f"Unsupported settlement result: {result!r}")


def roi(
    profits: Sequence[Decimal | int | str],
    stakes: Sequence[Decimal | int | str],
) -> Decimal:
    """Return total net profit divided by total amount staked."""

    if len(profits) != len(stakes) or not profits:
        raise InvalidSettlement("Profits and stakes must be non-empty and equal length.")
    converted_stakes = [_decimal(value) for value in stakes]
    if any(value < 0 for value in converted_stakes):
        raise InvalidSettlement("Stake must be nonnegative.")
    denominator = sum(converted_stakes, Decimal(0))
    if denominator <= 0:
        raise InvalidSettlement("Total stake must be positive.")
    with localcontext() as context:
        context.prec = MATH_PRECISION
        return sum((_decimal(value) for value in profits), Decimal(0)) / denominator


def probability_clv(
    entry_market_odds: Mapping[str, int],
    closing_market_odds: Mapping[str, int],
    backed_selection: str,
) -> Decimal:
    """Return canonical Dime probability-space CLV.

    CLV = closing no-vig probability - entry no-vig probability.
    Callers must first establish that the snapshots refer to the same event,
    period, market, and line where applicable.
    """

    if set(entry_market_odds) != set(closing_market_odds):
        raise InvalidMarket("Entry and closing markets must have identical selections.")
    if backed_selection not in entry_market_odds:
        raise InvalidMarket("Backed selection is missing from the market.")
    entry = remove_vig_from_american(entry_market_odds)
    close = remove_vig_from_american(closing_market_odds)
    with localcontext() as context:
        context.prec = MATH_PRECISION
        return close[backed_selection] - entry[backed_selection]


def line_delta(
    opening_line: Decimal | int | str,
    current_line: Decimal | int | str,
) -> Decimal:
    """Return current line minus opening line."""

    return _decimal(current_line) - _decimal(opening_line)
