"""Validate a complete set of policy actions before a model advances a step."""
from copy import deepcopy


def choose_actions(policy, step, requests):
    offered = {request["actor"]: request["allowed"] for request in requests}
    choices = policy(step, deepcopy(requests))
    if not isinstance(choices, dict) or choices.keys() != offered.keys() or any(
        not isinstance(action, str) or action not in offered[actor] for actor, action in choices.items()
    ):
        raise ValueError("Policy must choose one offered action for every actor")
    return choices
