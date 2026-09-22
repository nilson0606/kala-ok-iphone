"""Publish model downloads only after the complete response has been received."""
from pathlib import Path
import time
from urllib.parse import urlsplit, urlunsplit
import requests
from tqdm import tqdm


def download_model_file(url, output_path):
    target = Path(output_path)
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.part')
    for attempt in range(3):
        try:
            # Ask GitHub for a fresh release redirect; stale CDN routes can stall large weights.
            parts = urlsplit(url)
            request_url = url
            if parts.hostname == 'github.com' and '/releases/download/' in parts.path:
                query = (parts.query + '&' if parts.query else '') + 'download=1&request=' + str(time.time_ns())
                request_url = urlunsplit(parts._replace(query=query))
            with requests.get(request_url, stream=True, timeout=(20, 60)) as response:
                response.raise_for_status()
                expected = int(response.headers.get('content-length', 0))
                received = 0
                with partial.open('wb') as output, tqdm(total=expected or None, unit='iB', unit_scale=True) as progress:
                    for chunk in response.iter_content(chunk_size=65536):
                        output.write(chunk)
                        received += len(chunk)
                        progress.update(len(chunk))
                if not received or (expected and received != expected):
                    raise OSError('Incomplete model download')
            partial.replace(target)
            return
        except (requests.RequestException, OSError) as error:
            partial.unlink(missing_ok=True)
            if attempt == 2:
                raise RuntimeError('模型下載未完成，請確認網路後重試；不完整檔案已清除。') from error
            time.sleep(1)
