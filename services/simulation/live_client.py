"""Bounded text-only adapters to the two authorized provider endpoints."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING
from hashlib import sha256
from http.client import HTTPSConnection, HTTPException
from socket import timeout

MAX_OUTPUT = 192
MAX_REQUEST_BYTES = 6_000
DEFAULT_SOCKET_TIMEOUT_SECONDS = 12
PRICING_DATE = "2026-11-16"
_PROMPT = ("You are one role in a synthetic economics lesson. Use only the supplied observation. "
           "Choose a single allowed action. Return a JSON object with exactly one field: action. "
           "Do not predict hidden facts, use tools, or write any ledger values.")


@dataclass(frozen=True)
class Provider:
    name: str
    model: str
    env: str
    host: str
    path: str
    currency: str
    input_rate: Decimal
    cached_rate: Decimal
    output_rate: Decimal
    reserve_micros: int

    def public(self):
        return {"provider": self.name, "model": self.model, "currency": self.currency,
                "max_per_attempt": self.reserve_micros / 1_000_000,
                "pricing_date": PRICING_DATE}


PROVIDERS = (
    # Reserve above the documented full-context standard/cache-write tariff plus bounded output.
    Provider("openai", "gpt-6-luna", "OPENAI_API_KEY", "api.openai.com", "/v1/responses", "USD",
             Decimal("0.10"), Decimal("0.01"), Decimal("0.50"), 500_000),
    Provider("deepseek", "deepseek-flash", "DEEPSEEK_API_KEY", "api.deepseek.com", "/chat/completions", "CNY",
             Decimal("2"), Decimal("0.04"), Decimal("8"), 2_100_000),
)


def configured():
    if os.environ.get("CIVITAS_LIVE_ENABLED") != "1":
        return ()
    return tuple(p for p in PROVIDERS if os.environ.get(p.env, "").strip())


def socket_timeout_seconds():
    try:
        seconds = int(os.environ.get("CIVITAS_LIVE_TIMEOUT_SECONDS", ""))
    except ValueError:
        return DEFAULT_SOCKET_TIMEOUT_SECONDS
    return seconds if 1 <= seconds <= 30 else DEFAULT_SOCKET_TIMEOUT_SECONDS


def safe_id(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value) \
        and not value.lower().startswith(("sk-", "bearer")) else None


def integer(value):
    return value if type(value) is int and value >= 0 else None


def parse_reply(provider, packet, request_id):
    usage_raw = packet.get("usage")
    usage = None
    choice = None
    reason = "invalid_model_output"
    if provider.name == "openai":
        if isinstance(usage_raw, dict):
            usage = make_usage(usage_raw.get("input_tokens"), usage_raw.get("output_tokens"),
                               (usage_raw.get("input_tokens_details") or {}).get("cached_tokens", 0))
        contents = [item for output in packet.get("output", []) if output.get("type") == "message"
                    for item in output.get("content", [])]
        text = "".join(item.get("text", "") for item in contents if item.get("type") == "output_text")
        if packet.get("status") != "completed" or any(item.get("type") == "refusal" for item in contents):
            text = None
            reason = "incomplete_or_refused"
    else:
        if isinstance(usage_raw, dict):
            cached = usage_raw.get("prompt_cache_hit_tokens")
            if cached is None:
                cached = (usage_raw.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
            usage = make_usage(usage_raw.get("prompt_tokens"), usage_raw.get("completion_tokens"), cached)
        first = next(iter(packet.get("choices", [])), {})
        text = (first.get("message") or {}).get("content") if first.get("finish_reason") == "stop" else None
    if isinstance(text, str) and len(text) <= 600:
        try:
            obj = json.loads(text)
        except ValueError:
            obj = None
        if isinstance(obj, dict) and set(obj) == {"action"} and isinstance(obj["action"], str):
            choice = obj["action"]
            reason = None
    return {"action": choice, "reason": reason, "usage": usage,
            "request_id": safe_id(request_id), "response_id": safe_id(packet.get("id")),
            "actual_model": safe_id(packet.get("model"))}


def make_usage(input_count, output_count, cached):
    counts = [integer(value) for value in (input_count, output_count, cached)]
    if any(value is None for value in counts) or counts[2] > counts[0]:
        return None
    return dict(zip(("input_tokens", "output_tokens", "cached_input_tokens"), counts))


def cost_micros(provider, usage):
    if usage is None:
        return None
    input_rate, cached_rate, output_rate = provider.input_rate, provider.cached_rate, provider.output_rate
    if provider.name == "openai" and usage["input_tokens"] > 272_000:
        input_rate *= 2
        cached_rate *= 2
        output_rate *= Decimal("1.5")
    cached = usage["cached_input_tokens"]
    total = input_rate * (usage["input_tokens"] - cached) + cached_rate * cached + output_rate * usage["output_tokens"]
    return int(total.to_integral_value(rounding=ROUND_CEILING))


def send(provider, observation, allowed, repair=False):
    key = os.environ.get(provider.env, "").strip()
    report = {"usage": None, "request_id": None, "response_id": None, "actual_model": None, "action": None}
    if not key:
        return {**report, "reason": "missing_key"}
    instruction = _PROMPT + (" The previous proposal was invalid. Use exactly one of the provided keys." if repair else "")
    message = json.dumps({"observation": observation, "allowed": allowed}, ensure_ascii=False, separators=(",", ":"))
    if provider.name == "openai":
        payload = {"model": provider.model, "instructions": instruction, "input": message,
                   "store": False, "service_tier": "default", "reasoning": {"effort": "none"},
                   "max_output_tokens": MAX_OUTPUT, "text": {"format": {"type": "json_schema",
                     "name": "lesson_action", "strict": True, "schema": {"type": "object",
                     "properties": {"action": {"type": "string", "enum": list(allowed)}},
                     "required": ["action"], "additionalProperties": False}}}}
    else:
        payload = {"model": provider.model, "max_tokens": MAX_OUTPUT, "thinking": {"type": "disabled"},
                   "response_format": {"type": "json_object"}, "messages": [
                    {"role": "system", "content": instruction + ' Example JSON: {"action":"allowed_key"}'},
                    {"role": "user", "content": message}]}
    body = json.dumps(payload, ensure_ascii=False).encode()
    if len(body) > MAX_REQUEST_BYTES:
        return {**report, "reason": "observation_too_large"}
    conn = HTTPSConnection(provider.host, timeout=socket_timeout_seconds())
    try:
        conn.request("POST", provider.path, body=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        response = conn.getresponse()
        request_id = safe_id(response.getheader("x-request-id"))
        if response.status != 200:
            code = {401: "auth_failed", 403: "access_denied", 404: "model_unavailable", 429: "rate_limited",
                    402: "payment_required"}.get(response.status, "provider_error")
            return {**report, "request_id": request_id, "reason": code, "http_status": response.status}
        raw = response.read(131_073)
        if len(raw) > 131_072:
            return {**report, "request_id": request_id, "reason": "invalid_provider_response"}
        packet = json.loads(raw)
        reply = parse_reply(provider, packet, request_id)
        return {**reply, "response_sha256": sha256(raw).hexdigest()}
    except timeout:
        return {**report, "reason": "timeout"}
    except (ValueError, AttributeError, TypeError, KeyError):
        return {**report, "reason": "invalid_provider_response"}
    except (OSError, HTTPException):
        return {**report, "reason": "network_error"}
    finally:
        conn.close()
