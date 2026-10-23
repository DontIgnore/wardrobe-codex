import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from PIL import Image
import server

class InputTests(unittest.TestCase):
    def test_reject_nonimage(self):
        with self.assertRaises(ValueError):
            server.decode_upload('data:image/png;base64,aGVsbG8=')

    def test_reject_oversized_item_list(self):
        with self.assertRaises(ValueError):
            server.validate_items([{'name':'top','description':'white'}] * 13)

    def test_reject_path_traversal(self):
        with self.assertRaises(ValueError):
            server.read_job('../../secret')

class FakeProcessor:
    def analyze(self, folder, image):
        return server.validate_items([{'name':'Топ','description':'white'}, {'name':'Сумка','description':'beige'}])

    def generate(self, folder, image, item):
        if item['name'] == 'Топ':
            raise RuntimeError('temporary image service failure')
        return '/media/test/bag.png'

class WorkflowTests(unittest.TestCase):
    def test_crop_clamps_padding_and_uses_original_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.png'
            Image.new('RGB', (100, 200), (12, 34, 56)).save(path)
            box = server.crop_bounds([0, 0.5, 0.25, 1], (100, 200))
            self.assertEqual(box, (0, 92, 33, 200))
            item = {'id': 'b'*32, 'bbox': [0, 0.5, 0.25, 1]}
            cropped = server.prepare_crop(Path(tmp), path, item)
            with Image.open(cropped) as image:
                self.assertEqual(image.size, (33, 108))
                self.assertEqual(image.getpixel((0, 0)), (12, 34, 56))

    def test_bad_coordinates_are_rejected(self):
        for box in ([0.5,0,0.2,1], [0,0,2,1], [0,0,float('nan'),1], [True,0,1,1]):
            with self.subTest(box=box), self.assertRaises(ValueError):
                server.crop_bounds(box, (100,200))

    def test_generation_runs_in_parallel(self):
        barrier = threading.Barrier(2, timeout=3)
        class ParallelProcessor(FakeProcessor):
            def generate(self, folder, image, item):
                barrier.wait()
                return '/media/test/' + item['id'] + '.png'
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'DATA', Path(tmp)), patch.object(server, 'PROCESSOR', ParallelProcessor()):
            job_id = 'c' * 32
            (Path(tmp) / job_id).mkdir()
            server.save({'id':job_id, 'created':1, 'status':'queued', 'source':f'/media/{job_id}/source.png', 'items':[], 'error':None})
            server.process(job_id)
            result = server.read_job(job_id)
            self.assertEqual(result['status'], 'done')
            self.assertEqual([i['status'] for i in result['items']], ['ready','ready'])

    def test_generation_continues_after_failure_and_retry_preserves_ready_item(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'DATA', Path(tmp)), patch.object(server, 'PROCESSOR', FakeProcessor()):
            job_id = 'a' * 32
            (Path(tmp) / job_id).mkdir()
            server.save({'id':job_id, 'created':1, 'status':'queued', 'source':f'/media/{job_id}/source.png', 'items':[], 'error':None})
            server.process(job_id)
            result = server.read_job(job_id)
            self.assertEqual(result['status'], 'partial')
            self.assertEqual([i['status'] for i in result['items']], ['failed','ready'])
            ready_image = result['items'][1]['image']
            with patch.object(server.PROCESSOR, 'generate', return_value='/media/test/top.png'):
                server.process(job_id, result['items'][0]['id'])
            final = server.read_job(job_id)
            self.assertEqual(final['status'], 'done')
            self.assertEqual(final['items'][1]['image'], ready_image)

if __name__ == '__main__':
    unittest.main()
