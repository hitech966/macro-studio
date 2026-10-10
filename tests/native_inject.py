"""Inject only the bounded test actions into the dedicated smoke target window."""
import json
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
from backend import NativeBackend
from core import execute, Control
actions = json.load(sys.stdin)
execute(actions, NativeBackend(), Control())
