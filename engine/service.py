"""Line-delimited JSON RPC worker. stdout is protocol only; no input in logs."""
import json
import platform
import sys
import threading
import time
from core import Control, Cancelled, execute, validate_macro, compile_script, MAX_ACTIONS, KEYS
from backend import NativeBackend, DryBackend

class Service:
    def __init__(self):
        self.output_lock = threading.Lock()
        self.lock = threading.RLock()
        self.state = 'idle'
        self.control = None
        self.listeners = []
        self.recorded = []
        self.record_held = {}
        self.last_event = 0
        self.last_move = 0
        self.pending_move = None
        self.record_position = None
        self.backend = None
        self.reserved_keys={'f6','f7','f8','f9'}
        self.last_heartbeat = time.monotonic()
        threading.Thread(target=self.watchdog, daemon=True).start()

    def watchdog(self):
        while True:
            time.sleep(.2)
            if self.control and self.state != 'idle' and time.monotonic() - self.last_heartbeat > 4:
                self.control.stop()

    def send(self, data):
        with self.output_lock:
            print(json.dumps(data, ensure_ascii=True), flush=True)

    def set_state(self, state):
        with self.lock:
            self.state = state
        self.send({'event': 'state', 'state': state})

    def capability(self):
        try:
            NativeBackend()
            return {'available': True, 'platform': platform.system(), 'message': 'Native input adapter ready. Test in a safe window before using a macro.'}
        except Exception as exc:
            return {'available': False, 'platform': platform.system(), 'message': str(exc)}

    def add(self, action, force=False):
        with self.lock:
            if self.state != 'recording': return
            now = time.monotonic()
            if action['type'] == 'move': self.record_position = (action['x'], action['y'])
            if action['type'] == 'move' and not force and now - self.last_move < .025:
                self.pending_move = action
                return
            if action['type'] != 'move': self.flush_move()
            else: self.pending_move = None
            if action['type'] == 'move': self.last_move = now
            if len(self.recorded) >= MAX_ACTIONS - 200:
                self.control.stop()
                return
            token = action.get('key') or action.get('button')
            if action['type'] in ('key_up', 'button_up') and (action['type'].replace('_up', '_down'), token) not in self.record_held:
                return
            action['delay'] = round((now - self.last_event) * 1000, 2)
            self.last_event = now
            self.recorded.append(action)
            token = action.get('key') or action.get('button')
            if action['type'] in ('key_down', 'button_down'):
                self.record_held[(action['type'], token)] = action
            if action['type'] in ('key_up', 'button_up'):
                self.record_held.pop((action['type'].replace('_up', '_down'), token), None)
            self.send({'event': 'record_action', 'action': action})

    def flush_move(self):
        with self.lock:
            if self.pending_move is not None:
                action, self.pending_move = self.pending_move, None
                self.add(action, force=True)

    def balance_recording(self):
        with self.lock:
            for (kind, token) in list(self.record_held):
                a = {'type': kind.replace('_down', '_up'), 'delay': 0}
                a['key' if kind == 'key_down' else 'button'] = token
                self.recorded.append(a)
                self.send({'event': 'record_action', 'action': a})
            self.record_held.clear()

    def record(self, countdown):
        try:
            self.backend = NativeBackend()
            self.control.wait_until(time.monotonic(), countdown)
            k = self.backend.keyboard_module
            m = self.backend.mouse_module
            def key_event(key, pressed):
                name = getattr(key, 'name', None) or getattr(key, 'char', None)
                if name and len(name) == 1 and 1 <= ord(name) <= 26:
                    name = chr(ord(name) + 96)
                if not name or name in self.reserved_keys or (len(name) > 1 and name not in KEYS): return
                self.add({'type': 'key_down' if pressed else 'key_up', 'key': name})
            self.listeners = [
                m.Listener(on_move=lambda x,y: self.add({'type':'move','x':x,'y':y}),
                    on_click=lambda x,y,b,p: self.click_event(x,y,b,p),
                    on_scroll=lambda x,y,dx,dy: self.scroll_event(x,y,dx,dy)),
                k.Listener(on_press=lambda key: key_event(key, True), on_release=lambda key: key_event(key, False))]
            self.last_event = time.monotonic()
            self.record_position = self.backend.position()
            for listener in self.listeners: listener.start()
            for listener in self.listeners: listener.wait()
            with self.lock:
                if self.control.cancelled: raise Cancelled()
                self.set_state('recording')
            while not self.control.cancelled:
                # Some OS/controller paths do not deliver movement hook events.
                # Sample position only during explicit recording; never while paused.
                with self.lock:
                    if self.state == 'recording':
                        position = self.backend.position()
                        if position != self.record_position:
                            self.add({'type':'move','x':position[0],'y':position[1]})
                    self.flush_move()
                for listener in self.listeners:
                    if not listener.is_alive():
                        listener.join()  # surfaces permission or callback exceptions
                        raise RuntimeError('Input listener stopped. Check OS input permissions.')
                time.sleep(.02)
        except Cancelled:
            pass
        except Exception as exc:
            self.send({'event':'error','message':str(exc)})
        finally:
            for listener in self.listeners: listener.stop()
            for listener in self.listeners:
                try: listener.join(timeout=1)
                except Exception: pass
            self.listeners = []
            self.flush_move()
            self.balance_recording()
            self.send({'event':'record_complete','actions':self.recorded})
            self.set_state('idle')

    def click_event(self, x, y, button, pressed):
        if button.name not in ('left','right','middle'): return
        self.add({'type':'move','x':x,'y':y}, force=True)
        self.add({'type':'button_down' if pressed else 'button_up','button':button.name})

    def scroll_event(self, x, y, dx, dy):
        self.add({'type':'move','x':x,'y':y}, force=True)
        self.add({'type':'scroll','dx':dx,'dy':dy})

    def play(self, macro, speed, loops, countdown, dry):
        listener = None
        try:
            self.backend = DryBackend(record_events=False) if dry else NativeBackend()
            if not dry:
                listener = self.backend.mouse_module.Listener(on_move=lambda x,y: self.control.stop() if abs(x) <= 2 and abs(y) <= 2 else None)
                listener.start()
            execute(macro['actions'], self.backend, self.control, speed, loops, countdown, self.send)
            self.send({'event':'completed','dryRun':dry})
        except Cancelled:
            self.send({'event':'stopped','message':'Stopped safely; held input released.'})
        except Exception as exc:
            self.send({'event':'error','message':str(exc)})
        finally:
            if listener: listener.stop()
            self.set_state('idle')

    def handle(self, command, payload):
        if command == 'reserved_keys':
            if self.state != 'idle':raise ValueError('Stop automation before changing keybinds')
            keys=payload.get('keys')
            if not isinstance(keys,list) or len(keys)>4 or any(not isinstance(k,str) or len(k)>20 for k in keys):raise ValueError('Invalid reserved keys')
            self.reserved_keys=set(keys)
            return True
        if command == 'heartbeat':
            self.last_heartbeat = time.monotonic()
            return True
        if command == 'capabilities': return self.capability()
        if command == 'validate': return validate_macro(payload)
        if command == 'compile': return compile_script(payload['source'])
        if command == 'stop':
            if self.control: self.control.stop()
            return True
        if command == 'pause':
            with self.lock:
                if self.state in ('recording', 'recording_paused'):
                    if self.state == 'recording':
                        self.flush_move()
                        self.balance_recording()
                        self.set_state('recording_paused')
                    else:
                        self.last_event = time.monotonic()
                        self.set_state('recording')
                elif self.state in ('playing', 'paused'):
                    self.set_state('paused' if self.control.toggle_pause() else 'playing')
                else: raise ValueError('Nothing to pause')
            return True
        if command in ('record', 'play'):
            with self.lock:
                if self.state != 'idle': raise ValueError('Engine is busy')
                countdown = payload.get('countdown', 3)
                from core import number
                number(countdown, 0, 10, 'Countdown')
                if command == 'play':
                    macro = validate_macro(payload['macro'])
                    speed = number(payload.get('speed', 1), .1, 10, 'Speed')
                    loops = number(payload.get('loops', 1), 0, 1000, 'Loops')
                    if loops != int(loops): raise ValueError('Loops must be an integer')
                    if not macro['actions']: raise ValueError('Macro has no actions')
                self.control = Control()
                self.last_heartbeat = time.monotonic()
                if command == 'record':
                    self.recorded = []
                    self.pending_move = None
                    self.last_move = 0
                    self.record_held = {}
                    self.set_state('arming')
                    target, args = self.record, (countdown,)
                else:
                    self.set_state('playing')
                    target, args = self.play, (macro, speed, loops, countdown, bool(payload.get('dryRun', False)))
                threading.Thread(target=target, args=args, daemon=True).start()
                return True
        raise ValueError('Unknown command')

def main():
    service = Service()
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 8_000_000: raise ValueError('Request too large')
            request = json.loads(line)
            result = service.handle(request['command'], request.get('payload', {}))
            service.send({'id':request['id'], 'result':result})
        except Exception as exc:
            service.send({'id':request.get('id') if isinstance(request,dict) else None, 'error':str(exc)})
    if service.control:
        service.control.stop()
        # Give the worker time to release held input when parent closes its pipe.
        deadline = time.monotonic() + 3
        while service.state != 'idle' and time.monotonic() < deadline: time.sleep(.02)

if __name__ == '__main__': main()
