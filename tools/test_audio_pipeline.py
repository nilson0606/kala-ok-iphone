import unittest
from audio_pipeline import normalize_url


class URLTests(unittest.TestCase):
    def test_canonical_url(self):
        expected = 'https://www.youtube.com/watch?v=M7lc1UVf-VE'
        for url in ('https://youtu.be/M7lc1UVf-VE?t=30', 'https://m.youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com/shorts/M7lc1UVf-VE'):
            self.assertEqual(normalize_url(url), expected)

    def test_reject_other_hosts_and_invalid_ids(self):
        for url in ('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'file:///etc/passwd', 'https://127.0.0.1/watch?v=M7lc1UVf-VE', 'https://youtu.be/short', 'https://youtube.com/playlist?list=test'):
            with self.assertRaises(ValueError):
                normalize_url(url)


if __name__ == '__main__':
    unittest.main()
