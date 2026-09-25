import socket
import subprocess
import threading
import time
import unittest
from unittest.mock import patch, MagicMock
from download_network import check_ipv6, download


class NetworkTests(unittest.TestCase):
    def test_ipv6_success_is_used_and_checked_again_for_each_download(self):
        run=MagicMock(return_value='ok');emit=MagicMock()
        with patch('download_network.check_ipv6', side_effect=[(False,'timeout'),(True,'connected')]) as check:
            download(['yt-dlp','url'],run=run,emit=emit)
            download(['yt-dlp','url'],run=run,emit=emit)
        self.assertEqual(check.call_count,2)
        self.assertEqual([c.args[0][-1] for c in run.call_args_list],['--force-ipv4','--force-ipv6'])

    def test_ipv6_download_connection_failure_falls_back_once(self):
        run=MagicMock(side_effect=[RuntimeError('Connection timed out'), 'ok']);emit=MagicMock()
        with patch('download_network.check_ipv6',return_value=(True,'connected')):
            self.assertEqual(download(['yt-dlp','url'],run=run,emit=emit),'ok')
        self.assertEqual([c.args[0][-1] for c in run.call_args_list],['--force-ipv6','--force-ipv4'])
        self.assertEqual(emit.call_args.kwargs['networkReason'],'download-connection-failed')

    def test_access_restrictions_and_invalid_videos_are_not_retried(self):
        for message in ['HTTP Error 403: Forbidden','HTTP Error 429','Sign in to confirm','Private video','Video not available']:
            run=MagicMock(side_effect=RuntimeError(message))
            with patch('download_network.check_ipv6',return_value=(True,'connected')):
                with self.assertRaisesRegex(RuntimeError,message):
                    download(['yt-dlp','url'],run=run,emit=MagicMock())
            self.assertEqual(run.call_count,1)

    def test_both_families_failing_report_the_error_without_retry_loop(self):
        run=MagicMock(side_effect=RuntimeError('Connection timed out'))
        with patch('download_network.check_ipv6',return_value=(True,'connected')):
            with self.assertRaises(RuntimeError):download(['yt-dlp','url'],run=run,emit=MagicMock())
        self.assertEqual(run.call_count,2)

    def test_socket_probe_closes_socket_and_keeps_original_socket_defaults(self):
        default=socket.getdefaulttimeout()
        connection=MagicMock();connection.__enter__.return_value=connection
        addresses=[(socket.AF_INET6,socket.SOCK_STREAM,6,'',('::1',443,0,0))]
        with patch('download_network.socket.getaddrinfo',return_value=addresses),patch('download_network.socket.socket',return_value=connection):
            self.assertEqual(check_ipv6(.2),(True,'connected'))
        connection.connect.assert_called_once_with(('::1',443,0,0))
        connection.__exit__.assert_called_once()
        self.assertEqual(socket.getdefaulttimeout(),default)

    def test_blocked_dns_does_not_exceed_preflight_budget(self):
        release=threading.Event()
        def lookup(*args):release.wait(2);return []
        try:
            with patch('download_network.socket.getaddrinfo',side_effect=lookup):
                start=time.monotonic();self.assertEqual(check_ipv6(.03),(False,'timeout'))
                self.assertLess(time.monotonic()-start,.3)
        finally:release.set()

    def test_dns_without_ipv6_falls_back(self):
        with patch('download_network.socket.getaddrinfo',side_effect=socket.gaierror('no IPv6')):
            self.assertEqual(check_ipv6(.2),(False,'dns-unavailable'))

if __name__=='__main__':unittest.main()
