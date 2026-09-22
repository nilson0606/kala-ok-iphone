import unittest
from audio_pipeline import normalize_url, separation_progress, run_separation, choose_device, separate_audio, separate_lead
from unittest.mock import patch, MagicMock
import sys
from pathlib import Path


class URLTests(unittest.TestCase):
    def test_canonical_url(self):
        expected = 'https://www.youtube.com/watch?v=M7lc1UVf-VE'
        for url in ('https://youtu.be/M7lc1UVf-VE?t=30', 'https://m.youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com/shorts/M7lc1UVf-VE'):
            self.assertEqual(normalize_url(url), expected)

    def test_reject_other_hosts_and_invalid_ids(self):
        for url in ('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'file:///etc/passwd', 'https://127.0.0.1/watch?v=M7lc1UVf-VE', 'https://youtu.be/short', 'https://youtube.com/playlist?list=test'):
            with self.assertRaises(ValueError):
                normalize_url(url)


class ProgressTests(unittest.TestCase):
    def test_only_separation_bars_are_recognized(self):
        self.assertEqual(separation_progress(' 50%|##### | 7.8/15.6 [00:02<00:02, 3.9seconds/s]'), 50)
        self.assertEqual(separation_progress('100%|##########| 15.6/15.6 [00:04<00:00, 3.9seconds/s]'), 100)
        self.assertIsNone(separation_progress('50%|##### | 40M/80M [00:02, 20MB/s]'))
        self.assertIsNone(separation_progress('Loading model'))

    def test_lead_progress_excludes_weight_downloads(self):
        self.assertEqual(separation_progress(' 20%|## | 2/10 [00:01<00:03, 2.02it/s]', 'lead_separating'),20)
        self.assertIsNone(separation_progress(' 20%|## | 182M/913M [00:04<00:17, 40.8MiB/s]', 'lead_separating'))

    def test_subprocess_progress_is_forwarded_in_order(self):
        script = "import sys; print('\\r  0%| | 0/2 [00:00<?, ?seconds/s]\\r 50%|# | 1/2 [00:01<00:01, 1seconds/s]\\r100%|##| 2/2 [00:02<00:00, 1seconds/s]', file=sys.stderr, flush=True)"
        with patch('audio_pipeline.emit') as callback:
            run_separation([sys.executable, '-c', script], timeout=10)
            self.assertEqual([call.kwargs['progress'] for call in callback.call_args_list], [0, 50, 100])


class DeviceTests(unittest.TestCase):
    def test_auto_device_selection_and_unavailable_driver(self):
        torch = MagicMock()
        with patch.dict(sys.modules, {'torch': torch}):
            torch.cuda.is_available.return_value = False
            self.assertEqual(choose_device()['device'], 'cpu')
            torch.cuda.is_available.return_value = True
            torch.cuda.get_device_name.return_value = 'Test GPU'
            self.assertEqual(choose_device(), {'device': 'cuda', 'deviceName': 'Test GPU'})
            self.assertEqual(choose_device('cpu')['device'], 'cpu')
            torch.cuda.get_device_name.side_effect = RuntimeError('driver unavailable')
            self.assertEqual(choose_device()['device'], 'cpu')

    def test_gpu_oom_retries_once_on_cpu_with_reset_progress(self):
        with patch('audio_pipeline.choose_device', return_value={'device': 'cuda', 'deviceName': 'Test GPU'}), patch('audio_pipeline.run_separation', side_effect=[RuntimeError('CUDA out of memory'), None]) as run, patch('audio_pipeline.emit') as emit:
            result = separate_audio(Path('input.wav'), Path('test-job'))
            self.assertEqual(result['device'], 'cpu')
            self.assertTrue(result['fallback'])
            self.assertEqual([c.args[0][c.args[0].index('-d')+1] for c in run.call_args_list], ['cuda', 'cpu'])
            self.assertEqual([c.kwargs['progress'] for c in emit.call_args_list], [0, 0])
            self.assertTrue(emit.call_args_list[-1].kwargs['fallback'])

    def test_lead_fallback_disables_cuda_in_fresh_worker(self):
        with patch('audio_pipeline.choose_device', return_value={'device':'cuda','deviceName':'Test GPU'}), patch('audio_pipeline.run_separation', side_effect=[RuntimeError('CUDA out of memory'),None]) as run, patch('audio_pipeline.emit') as emit:
            result=separate_lead(Path('vocals.wav'),Path('test-job'))
            self.assertEqual(result['device'],'cpu')
            self.assertEqual(run.call_args_list[1].kwargs['env']['CUDA_VISIBLE_DEVICES'],'')
            self.assertEqual(run.call_args_list[1].kwargs['stage'],'lead_separating')
            self.assertEqual([c.kwargs['progress'] for c in emit.call_args_list],[0,0])

    def test_bs_roformer_routes_worker_and_retries_cpu(self):
        with patch('audio_pipeline.choose_device', return_value={'device':'cuda','deviceName':'Test GPU'}), patch('audio_pipeline.run_separation', side_effect=[RuntimeError('CUDA out of memory'),None]) as run, patch('audio_pipeline.emit') as emit:
            result = separate_audio(Path('input.wav'),Path('test-job'),model='bs-roformer')
            self.assertEqual(result['device'],'cpu')
            self.assertEqual(run.call_count,2)
            self.assertEqual(run.call_args_list[0].args[0][3],'bs-roformer')
            self.assertIn(Path('test-job/stems/bs-roformer/input'),run.call_args_list[0].args[0])
            self.assertEqual(run.call_args_list[1].kwargs['env']['CUDA_VISIBLE_DEVICES'],'')
            self.assertEqual([c.kwargs['model'] for c in emit.call_args_list],['bs-roformer','bs-roformer'])
        self.assertEqual(separation_progress(' 20%|## | 2/10 [00:01<00:03, 2.02it/s]'),20)
        self.assertIsNone(separation_progress('20%|## | 182M/913M [00:04<00:17, 40.8MiB/s]'))

    def test_gpu_success_does_not_retry(self):
        with patch('audio_pipeline.choose_device', return_value={'device': 'cuda', 'deviceName': 'Test GPU'}), patch('audio_pipeline.run_separation') as run, patch('audio_pipeline.emit'):
            self.assertEqual(separate_audio(Path('input.wav'), Path('test-job'))['device'], 'cuda')
            run.assert_called_once()

    def test_non_gpu_errors_are_not_retried(self):
        with patch('audio_pipeline.choose_device', return_value={'device': 'cuda', 'deviceName': 'Test GPU'}), patch('audio_pipeline.run_separation', side_effect=RuntimeError('invalid audio file')) as run, patch('audio_pipeline.emit'):
            with self.assertRaisesRegex(RuntimeError, 'invalid audio'):
                separate_audio(Path('input.wav'), Path('test-job'))
            run.assert_called_once()

    def test_cpu_failure_after_fallback_is_propagated(self):
        with patch('audio_pipeline.choose_device', return_value={'device': 'cuda', 'deviceName': 'Test GPU'}), patch('audio_pipeline.run_separation', side_effect=[RuntimeError('CUDA error'), RuntimeError('CPU error')]) as run, patch('audio_pipeline.emit'):
            with self.assertRaisesRegex(RuntimeError, 'CPU error'):
                separate_audio(Path('input.wav'), Path('test-job'))
            self.assertEqual(run.call_count, 2)

if __name__ == '__main__':
    unittest.main()
