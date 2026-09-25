"""Bounded IPv6 preflight and per-download IPv4 fallback; no OS settings changed."""
from __future__ import annotations

import queue
import re
import socket
import subprocess
import threading
import time


IPV6_CHECK_TIMEOUT = 2.0


def check_ipv6(timeout=IPV6_CHECK_TIMEOUT):
    # DNS resolution can also block. A daemon worker and an overall deadline keep
    # this check bounded without changing socket defaults for other threads.
    result = queue.Queue()
    deadline = time.monotonic() + timeout

    def probe():
        try:
            addresses = socket.getaddrinfo('www.youtube.com', 443, socket.AF_INET6, socket.SOCK_STREAM)
            for family, kind, protocol, _, address in addresses:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    with socket.socket(family, kind, protocol) as connection:
                        connection.settimeout(remaining)
                        connection.connect(address)
                    result.put((True, 'connected'))
                    return
                except OSError:
                    continue
            result.put((False, 'unreachable'))
        except OSError:
            result.put((False, 'dns-unavailable'))

    threading.Thread(target=probe, daemon=True).start()
    try:
        return result.get(timeout=timeout)
    except queue.Empty:
        return False, 'timeout'


def connection_failure(error):
    # Do not treat HTTP access restrictions (403/429), sign-in requirements or
    # unavailable videos as a network-family failure.
    message = str(error).lower()
    if re.search(r'\b(?:403|429)\b|sign in|private video|not available', message):
        return False
    return isinstance(error, subprocess.TimeoutExpired) or bool(re.search(
        r'timed? out|timeout|network is unreachable|network unreachable|'
        r'no route to host|connection (?:refused|reset|aborted)|'
        r'failed to establish a new connection|unable to resolve|'
        r'name or service not known|getaddrinfo failed', message))


def download(command, *, run, emit):
    emit('download', message=f'檢查 YouTube IPv6 連線（最多 {IPV6_CHECK_TIMEOUT:g} 秒）…')
    available, reason = check_ipv6()
    if available:
        emit('download', networkFamily='IPv6', networkReason=reason,
             message='IPv6 連線正常，正在取得 YouTube 音訊…')
        try:
            return run([*command, '--force-ipv6'], timeout=600)
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            if not connection_failure(error):
                raise
            reason = 'download-connection-failed'
    emit('download', networkFamily='IPv4', networkReason=reason,
         message='IPv6 暫時無法連線，已自動使用 IPv4 繼續下載；不需重新操作。')
    return run([*command, '--force-ipv4'], timeout=600)
