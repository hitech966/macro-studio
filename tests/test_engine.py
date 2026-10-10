import os
import sys
import threading
import time
import unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
from core import Control, Cancelled, execute, compile_script, validate_macro, validate_actions
from backend import DryBackend
from service import Service

class EngineTests(unittest.TestCase):
    def test_script_repeat_and_condition(self):
        a = compile_script('repeat 2\nmove 50 60\nif_cursor 50 60 2\ntype "hello world"\nend\nend')
        b = DryBackend(); execute(a, b, Control())
        self.assertEqual([e['type'] for e in b.events], ['move', 'text', 'move', 'text'])
        self.assertTrue(b.released)

    def test_false_condition_skips(self):
        b = DryBackend(); execute(compile_script('if_cursor 0 0 1\nclick left\nend'), b, Control())
        self.assertEqual(b.events, [])

    def test_script_errors_and_no_eval(self):
        for script in ['end', 'repeat 2\nwait 1', 'import os', '__import__("os")', 'wait nan', 'wait -1', 'click other', 'repeat 1001\nwait 0\nend', 'type hello']:
            with self.subTest(script=script), self.assertRaises(ValueError): compile_script(script)

    def test_bounded_expansion(self):
        with self.assertRaises(ValueError): compile_script('repeat 1000\nrepeat 1000\nwait 0\nend\nend')

    def test_validation(self):
        for value in [True, -1, float('nan'), float('inf'), '1']:
            with self.subTest(value=value), self.assertRaises(ValueError): validate_actions([{'type':'wait','delay':value}])
        with self.assertRaises(ValueError): validate_actions([{'type':'shell','command':'ls'}])
        with self.assertRaises(ValueError): validate_actions([{'type':'key','key':'invalid'}])
        with self.assertRaises(ValueError): validate_macro({'version':2,'name':'x','actions':[]})

    def test_order_and_loops(self):
        b=DryBackend(); execute(compile_script('key a\nkey b'),b,Control(),loops=3)
        self.assertEqual([e['key'] for e in b.events], list('ababab'))

    def test_speed_scales_delays(self):
        b=DryBackend(); start=time.monotonic()
        execute([{'type':'wait','delay':200}],b,Control(),speed=2)
        self.assertGreaterEqual(time.monotonic()-start,.09)
        self.assertLess(time.monotonic()-start,.3)

    def test_cancel_long_wait_releases(self):
        b=DryBackend(); c=Control(); errors=[]
        def run():
            try: execute([{'type':'wait','delay':100000}],b,c)
            except Cancelled: errors.append('cancelled')
        t=threading.Thread(target=run);t.start();time.sleep(.025);c.stop();t.join(.5)
        self.assertFalse(t.is_alive());self.assertEqual(errors,['cancelled']);self.assertTrue(b.released)

    def test_pause_freezes_clock_and_resumes(self):
        b=DryBackend();c=Control();c.toggle_pause()
        t=threading.Thread(target=lambda:execute([{'type':'key','key':'a','delay':40}],b,c));t.start()
        time.sleep(.08);self.assertEqual(b.events,[]);c.toggle_pause();t.join(.5)
        self.assertFalse(t.is_alive());self.assertEqual(len(b.events),1)

    def test_stop_while_paused(self):
        b=DryBackend();c=Control();c.toggle_pause();c.stop()
        with self.assertRaises(Cancelled):execute([{'type':'key','key':'a','delay':0}],b,c)
        self.assertTrue(b.released)

    def test_backend_error_releases(self):
        class Broken(DryBackend):
            def perform(self,a,c): raise RuntimeError('driver failed')
        b=Broken()
        with self.assertRaises(RuntimeError):execute([{'type':'key','key':'a','delay':0}],b,Control())
        self.assertTrue(b.released)

    def test_failsafe_releases(self):
        class Unsafe(DryBackend):
            def check_failsafe(self):raise Cancelled('corner')
        b=Unsafe()
        with self.assertRaises(Cancelled):execute([{'type':'click','button':'left'}],b,Control())
        self.assertTrue(b.released)

    def test_busy_state_rejected(self):
        s=Service();s.state='recording'
        with self.assertRaises(ValueError):s.handle('record',{})

    def test_recording_explicit_and_balanced(self):
        s=Service(); events=[];s.send=events.append
        s.add({'type':'key_down','key':'a'});self.assertEqual(s.recorded,[])
        s.state='recording';s.last_event=time.monotonic()
        s.add({'type':'key_down','key':'a'});s.balance_recording()
        self.assertEqual([a['type'] for a in s.recorded],['key_down','key_up'])
        s.state='recording_paused';s.add({'type':'key_down','key':'b'});self.assertEqual(len(s.recorded),2)

    def test_continuous_loop_stops_and_releases(self):
        b=DryBackend();c=Control();progress=[]
        def emit(e):
            progress.append(e)
            if e['loop']==3:c.stop()
        with self.assertRaises(Cancelled):execute([{'type':'key','key':'a','delay':0}],b,c,loops=0,emit=emit)
        self.assertEqual(len(b.events),3);self.assertTrue(b.released)

    def test_dry_run_can_avoid_retaining_unlimited_events(self):
        b=DryBackend(record_events=False);execute([{'type':'move','x':50,'y':60,'delay':0}],b,Control())
        self.assertEqual(b.events,[]);self.assertEqual(b.position(),(50,60))

    def test_reservations_change_only_while_idle(self):
        s=Service();s.handle('reserved_keys',{'keys':['f10','f11']});self.assertEqual(s.reserved_keys,{'f10','f11'})
        s.state='recording'
        with self.assertRaises(ValueError):s.handle('reserved_keys',{'keys':['f6']})

    def test_fast_move_retains_final_position_without_click(self):
        s=Service();s.send=lambda e:None;s.state='recording'
        s.last_event=time.monotonic()
        s.add({'type':'move','x':100,'y':100})
        s.last_move=time.monotonic()+1  # deterministic sampling window
        s.add({'type':'move','x':120,'y':130})
        s.add({'type':'move','x':140,'y':150})
        self.assertEqual(len(s.recorded),1)
        s.flush_move()
        self.assertEqual([(a['x'],a['y']) for a in s.recorded],[(100,100),(140,150)])
        s.flush_move();self.assertEqual(len(s.recorded),2)

    def test_pending_move_precedes_keyboard_and_pause_ignores_motion(self):
        s=Service();s.send=lambda e:None;s.state='recording';s.control=Control()
        s.last_move=time.monotonic()+1;s.last_event=time.monotonic()
        s.add({'type':'move','x':200,'y':210})
        s.add({'type':'key_down','key':'a'})
        self.assertEqual([a['type'] for a in s.recorded],['move','key_down'])
        s.handle('pause',{})
        s.add({'type':'move','x':300,'y':310});s.flush_move()
        self.assertEqual(s.recorded[0]['x'],200)
        self.assertEqual(len(s.recorded),3)

if __name__=='__main__':unittest.main()
