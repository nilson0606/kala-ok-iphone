import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import requests
from model_download import download_model_file


class ModelDownloadTests(unittest.TestCase):
    def response(self, chunks, length=6):
        response=MagicMock()
        response.__enter__.return_value=response
        response.headers={'content-length':str(length)}
        response.iter_content.side_effect=lambda **kwargs: iter(chunks)
        return response

    def test_partial_response_retried_and_only_complete_file_published(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'model.ckpt'
            with patch('model_download.requests.get',side_effect=[self.response([b'bad']),self.response([b'abc',b'def'])]) as get, patch('model_download.time.sleep'), patch('model_download.tqdm'):
                download_model_file('https://fixture/model',target)
                self.assertEqual(get.call_count,2)
                self.assertEqual(target.read_bytes(),b'abcdef')
                self.assertFalse(target.with_suffix('.ckpt.part').exists())
                download_model_file('https://fixture/model',target)
                self.assertEqual(get.call_count,2)

    def test_failed_download_does_not_leave_a_model_or_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'model.ckpt'
            response=self.response([])
            def broken(**kwargs):
                yield b'abc'
                raise requests.exceptions.ChunkedEncodingError('interrupted')
            response.iter_content.side_effect=broken
            with patch('model_download.requests.get',return_value=response), patch('model_download.time.sleep'), patch('model_download.tqdm'):
                with self.assertRaisesRegex(RuntimeError,'模型下載未完成'):
                    download_model_file('https://fixture/model',target)
            self.assertEqual(list(Path(directory).iterdir()),[])

if __name__=='__main__':unittest.main()
