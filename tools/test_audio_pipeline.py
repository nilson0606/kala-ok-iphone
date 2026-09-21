import unittest
from audio_pipeline import normalize_url, separation_progress, run_separation
from unittest.mock import patch
import sys


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

    def test_subprocess_progress_is_forwarded_in_order(self):
        script = "import sys; print('\\r  0%| | 0/2 [00:00<?, ?seconds/s]\\r 50%|# | 1/2 [00:01<00:01, 1seconds/s]\\r100%|##| 2/2 [00:02<00:00, 1seconds/s]', file=sys.stderr, flush=True)"
        with patch('audio_pipeline.emit') as callback:
            run_separation([sys.executable, '-c', script], timeout=10)
            self.assertEqual([call.kwargs['progress'] for call in callback.call_args_list], [0, 50, 100])

if __name__ == '__main__':
    unittest.main()
