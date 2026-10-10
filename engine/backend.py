"""Native adapter. Hooks exist only while explicitly recording or playing."""
import os
import sys
from core import Cancelled

class NativeBackend:
    def __init__(self):
        if sys.platform == 'win32':
            # Both recorded and injected positions use physical screen pixels.
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        if sys.platform.startswith('linux') and os.environ.get('XDG_SESSION_TYPE') == 'wayland':
            raise RuntimeError('Wayland global input is unsupported. Sign in with an X11 session.')
        from pynput import keyboard, mouse
        if sys.platform == 'darwin' and not keyboard.Listener.IS_TRUSTED:
            raise RuntimeError('Grant Accessibility and Input Monitoring to this app/Python in System Settings, then restart.')
        self.keyboard_module = keyboard
        self.mouse_module = mouse
        self.keyboard = keyboard.Controller()
        self.mouse = mouse.Controller()
        self.keys = set()
        self.buttons = set()

    def key(self, name):
        return getattr(self.keyboard_module.Key, name) if len(name) > 1 else self.keyboard_module.KeyCode.from_char(name)

    def position(self):
        return self.mouse.position

    def check_failsafe(self):
        x, y = self.position()
        if abs(x) <= 2 and abs(y) <= 2:
            raise Cancelled('Pointer reached emergency corner (0, 0)')

    def perform(self, a, control):
        t = a['type']
        if t == 'move':
            self.mouse.position = (int(a['x']), int(a['y']))
            if self.position() != (int(a['x']), int(a['y'])):
                raise RuntimeError('Pointer did not reach the requested coordinates. Check screen layout and the interactive input desktop.')
            self.check_failsafe()
        elif t == 'scroll':
            self.mouse.scroll(int(a['dx']), int(a['dy']))
        elif t in ('click', 'button_down', 'button_up'):
            button = getattr(self.mouse_module.Button, a['button'])
            if t in ('click', 'button_down'):
                self.buttons.add(button)
                self.mouse.press(button)
            if t in ('click', 'button_up'):
                self.mouse.release(button)
                self.buttons.discard(button)
        elif t in ('key', 'key_down', 'key_up'):
            key = self.key(a['key'])
            if t in ('key', 'key_down'):
                self.keys.add(key)
                self.keyboard.press(key)
            if t in ('key', 'key_up'):
                self.keyboard.release(key)
                self.keys.discard(key)
        elif t == 'text':
            # Check cancellation between characters; no uninterruptible long type().
            import time
            for char in a['text']:
                control.wait_until(0, float('-inf'))
                self.check_failsafe()
                key = self.key(char)
                self.keys.add(key)
                self.keyboard.press(key)
                self.keyboard.release(key)
                self.keys.discard(key)

    def release_all(self):
        errors = []
        for key in list(self.keys):
            try:
                self.keyboard.release(key)
                self.keys.discard(key)
            except Exception as exc:
                errors.append(str(exc))
        for button in list(self.buttons):
            try:
                self.mouse.release(button)
                self.buttons.discard(button)
            except Exception as exc:
                errors.append(str(exc))
        if errors:
            raise RuntimeError('Could not release all held input: ' + '; '.join(errors))

class DryBackend:
    def __init__(self, record_events=True):
        self.events = []
        self.record_events = record_events
        self.xy = (100, 100)
        self.released = False
    def position(self): return self.xy
    def check_failsafe(self): pass
    def perform(self, a, control):
        if self.record_events:self.events.append(a)
        if a['type'] == 'move': self.xy = (a['x'], a['y'])
    def release_all(self): self.released = True
