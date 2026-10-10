"""Pure, bounded macro model and deterministic scheduler; no OS hooks here."""
import json
import math
import shlex
import threading
import time
import itertools

MAX_ACTIONS = 20000
KEYS = set('alt alt_l alt_r alt_gr backspace caps_lock cmd cmd_l cmd_r ctrl ctrl_l ctrl_r delete down end enter esc home insert left num_lock page_down page_up pause right scroll_lock shift shift_l shift_r space tab up print_screen'.split()) | {f'f{i}' for i in range(1, 21)}

def number(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} must be between {low} and {high}')
    return value

def validate_actions(actions, depth=0, budget=None):
    if depth > 8 or not isinstance(actions, list):
        raise ValueError('Actions must be a list with nesting at most 8')
    budget = budget if budget is not None else [0]
    result = []
    for raw in actions:
        budget[0] += 1
        if budget[0] > MAX_ACTIONS or not isinstance(raw, dict):
            raise ValueError('Too many actions or invalid action')
        kind = raw.get('type')
        a = {'type': kind, 'delay': number(raw.get('delay', 0), 0, 3600000, 'Delay')}
        if kind == 'move':
            a.update(x=number(raw.get('x'), -100000, 100000, 'X'), y=number(raw.get('y'), -100000, 100000, 'Y'))
        elif kind in ('click', 'button_down', 'button_up'):
            if raw.get('button') not in ('left', 'right', 'middle'):
                raise ValueError('Unknown mouse button')
            a['button'] = raw['button']
        elif kind == 'scroll':
            a.update(dx=number(raw.get('dx', 0), -1000, 1000, 'Scroll X'), dy=number(raw.get('dy', 0), -1000, 1000, 'Scroll Y'))
        elif kind in ('key_down', 'key_up', 'key'):
            key = raw.get('key')
            if not isinstance(key, str) or not (key in KEYS or len(key) == 1):
                raise ValueError('Use a single character or a supported key name')
            a['key'] = key
        elif kind == 'text':
            if not isinstance(raw.get('text'), str) or len(raw['text']) > 10000:
                raise ValueError('Text must be at most 10000 characters')
            a['text'] = raw['text']
        elif kind == 'wait':
            pass
        elif kind == 'if_cursor':
            a.update(x=number(raw.get('x'), -100000, 100000, 'X'), y=number(raw.get('y'), -100000, 100000, 'Y'), tolerance=number(raw.get('tolerance', 5), 0, 1000, 'Tolerance'))
            a['actions'] = validate_actions(raw.get('actions'), depth + 1, budget)
        else:
            raise ValueError(f'Unknown action: {kind}')
        result.append(a)
    return result

def validate_macro(raw):
    if not isinstance(raw, dict) or raw.get('version') != 1:
        raise ValueError('Expected Macro Studio version 1')
    name = raw.get('name')
    profile = raw.get('profile', 'Personal')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120 or not isinstance(profile, str) or len(profile) > 80:
        raise ValueError('Invalid name or profile')
    return {'version': 1, 'name': name.strip(), 'profile': profile, 'actions': validate_actions(raw.get('actions'))}

def compile_script(source):
    """Small automation language; deliberately no eval, filesystem or network."""
    if not isinstance(source, str) or len(source) > 200000:
        raise ValueError('Script too large')
    root = []
    stack = [(root, None)]
    for line_no, line in enumerate(source.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        try:
            if line.startswith('type '):
                stack[-1][0].append({'type': 'text', 'text': json.loads(line[5:]), 'delay': 0})
                continue
            p = shlex.split(line)
            op = p[0]
            args = p[1:]
            if op == 'end' and not args:
                if len(stack) == 1:
                    raise ValueError('Unexpected end')
                block, count = stack.pop()
                if count is not None:
                    if len(block) * count > MAX_ACTIONS:
                        raise ValueError('Repeat expands beyond action limit')
                    stack[-1][0].extend(block * count)
                continue
            if op == 'repeat' and len(args) == 1:
                n = int(args[0])
                number(n, 1, 1000, 'Repeat')
                if len(stack) > 8:
                    raise ValueError('Too much nesting')
                stack.append(([], n))
                continue
            a = {'type': op, 'delay': 0}
            if op == 'move' and len(args) == 2:
                a.update(x=float(args[0]), y=float(args[1]))
            elif op in ('click', 'button_down', 'button_up') and len(args) == 1:
                a['button'] = args[0]
            elif op == 'scroll' and len(args) == 2:
                a.update(dx=float(args[0]), dy=float(args[1]))
            elif op in ('key', 'key_down', 'key_up') and len(args) == 1:
                a['key'] = args[0]
            elif op == 'wait' and len(args) == 1:
                a['delay'] = float(args[0]) * 1000
            elif op == 'if_cursor' and len(args) == 3:
                a.update(x=float(args[0]), y=float(args[1]), tolerance=float(args[2]), actions=[])
                stack[-1][0].append(a)
                if len(stack) > 8:
                    raise ValueError('Too much nesting')
                stack.append((a['actions'], None))
                continue
            else:
                raise ValueError('Unknown command or wrong argument count')
            stack[-1][0].append(a)
            if len(stack[-1][0]) > MAX_ACTIONS:
                raise ValueError('Too many actions')
        except (ValueError, IndexError, TypeError) as exc:
            raise ValueError(f'Line {line_no}: {exc}') from exc
    if len(stack) != 1:
        raise ValueError('Missing end')
    return validate_actions(root)

class Cancelled(Exception):
    pass

class Control:
    def __init__(self):
        self.condition = threading.Condition()
        self.cancelled = False
        self.paused = False
        self.pause_started = None
        self.pause_total = 0.0

    def stop(self):
        with self.condition:
            self.cancelled = True
            self.condition.notify_all()

    def toggle_pause(self):
        with self.condition:
            if self.paused:
                self.pause_total += time.monotonic() - self.pause_started
                self.pause_started = None
            else:
                self.pause_started = time.monotonic()
            self.paused = not self.paused
            self.condition.notify_all()
            return self.paused

    def elapsed(self, start):
        now = self.pause_started if self.paused else time.monotonic()
        return now - start - self.pause_total

    def wait_until(self, start, target):
        with self.condition:
            while True:
                if self.cancelled:
                    raise Cancelled()
                if self.paused:
                    self.condition.wait(.02)
                    continue
                remaining = target - self.elapsed(start)
                if remaining <= 0:
                    return
                self.condition.wait(min(remaining, .02))

def execute(actions, backend, control, speed=1, loops=1, countdown=0, emit=lambda e: None):
    actions = validate_actions(actions)
    number(speed, .1, 10, 'Speed')
    number(loops, 0, 1000, 'Loops')
    if int(loops) != loops:
        raise ValueError('Loops must be an integer')
    number(countdown, 0, 10, 'Countdown')
    start = time.monotonic()
    deadline = countdown
    index = 0
    def run(block, loop):
        nonlocal deadline, index
        for action in block:
            deadline += action['delay'] / 1000 / speed
            control.wait_until(start, deadline)
            backend.check_failsafe()
            if action['type'] == 'if_cursor':
                x, y = backend.position()
                if math.hypot(x - action['x'], y - action['y']) <= action['tolerance']:
                    run(action['actions'], loop)
            elif action['type'] != 'wait':
                backend.perform(action, control)
            index += 1
            emit({'event': 'progress', 'index': index, 'loop': loop + 1})
    try:
        control.wait_until(start, deadline)
        for loop in (itertools.count() if loops == 0 else range(int(loops))):
            run(actions, loop)
            if loops == 0:
                # Bound zero-delay loops and keep stop/pause responsive.
                deadline = max(deadline, control.elapsed(start)) + .01
                control.wait_until(start, deadline)
    finally:
        backend.release_all()
