"""Verify the restricted SSH receiver without Docker or server changes."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).resolve().parents[1] / 'deploy/receive.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
SHA = 'a' * 40


def archive(name='Dockerfile', link=False):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as tar:
        item = tarfile.TarInfo(name)
        if link:
            item.type = tarfile.SYMTYPE
            item.linkname = '/etc/passwd'
            tar.addfile(item)
        else:
            payload = b'FROM python:3.12-slim\n'
            item.size = len(payload)
            tar.addfile(item, io.BytesIO(payload))
    return data.getvalue()


class DeploymentTests(unittest.TestCase):
    def test_disallowed_commands(self):
        for command in ('', 'bash', 'deploy main', 'deploy ' + SHA + ';id'):
            with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': command}):
                with self.assertRaises(ValueError):
                    receiver.main()

    def execute(self, payload, verification=None):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            with patch.object(receiver, 'BASE', base), patch.object(receiver, 'OVERRIDE', base/'override.json'), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': 'deploy '+SHA}), patch.object(receiver.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(payload))), patch.object(receiver, 'run') as run, patch.object(receiver.subprocess, 'check_output', return_value='previous-image\n'), patch.object(receiver, 'verify', side_effect=verification):
                if verification:
                    with self.assertRaises(RuntimeError):
                        receiver.main()
                    self.assertEqual(json.loads((base/'override.json').read_text())['services']['dashboard']['image'], 'previous-image')
                    self.assertFalse((base/'.deployed-revision').exists())
                else:
                    receiver.main()
                    self.assertEqual((base/'.deployed-revision').read_text().strip(), SHA)
                return run.call_count

    def test_deploy_and_rollback(self):
        self.assertGreater(self.execute(archive()), 0)
        self.assertGreater(self.execute(archive(), [RuntimeError('unhealthy'), None]), 0)

    def test_archive_boundary(self):
        for name, link in (('.env', False), ('compose.demo.yaml', False), ('/etc/passwd', False), ('dist/../../escape', False), ('dist/link', True)):
            with self.assertRaises(ValueError, msg=name):
                self.execute(archive(name, link))


if __name__ == '__main__':
    unittest.main()
