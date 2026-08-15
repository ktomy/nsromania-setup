from __future__ import annotations

import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path


VALIDATOR_PATH = Path(__file__).parents[1] / 'validate-artifact.py'
SPEC = importlib.util.spec_from_file_location('validate_artifact', VALIDATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)

COMMIT = '0123456789abcdef0123456789abcdef01234567'


def required_files() -> dict[str, bytes]:
    files = {name: b'content' for name in VALIDATOR.REQUIRED_MEMBERS}
    files['node_modules/.pnpm/pm2/node_modules/pm2/package.json'] = b'{}'
    files['node_modules/.pnpm/prisma/node_modules/@prisma/client/package.json'] = b'{}'
    files['node_modules/.pnpm/prisma/node_modules/@prisma/client/runtime/client.js'] = b'content'
    files['node_modules/.pnpm/prisma/node_modules/@prisma/client/runtime/query_compiler_fast_bg.mysql.mjs'] = b'content'
    files['node_modules/.pnpm/prisma/node_modules/@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.mjs'] = (
        b'content'
    )
    files['node_modules/.pnpm/swc/node_modules/@swc/helpers/package.json'] = b'{}'
    files['node_modules/@prisma/client/runtime/client.js'] = b'content'
    files['node_modules/@prisma/client/runtime/query_compiler_fast_bg.mysql.mjs'] = b'content'
    files['node_modules/@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.mjs'] = b'content'
    files['RELEASE_SHA'] = f'{COMMIT}\n'.encode()
    files['deployment-metadata.json'] = json.dumps(
        {
            'commit': COMMIT,
            'nodeVersion': 'v22.12.0',
        }
    ).encode()
    return files


def create_archive(
    path: Path,
    files: dict[str, bytes] | None = None,
    extra_members: list[tarfile.TarInfo] | None = None,
) -> None:
    with tarfile.open(path, mode='w:gz') as archive:
        for directory_name in ('node_modules/pm2', 'node_modules/@prisma/client', 'node_modules/@swc/helpers'):
            directory = tarfile.TarInfo(directory_name)
            directory.type = tarfile.DIRTYPE
            directory.mode = 0o755
            archive.addfile(directory)
        for name, content in (files or required_files()).items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(content))
        for member in extra_members or []:
            archive.addfile(member)


class ValidateArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.archive = Path(self.temp_directory.name) / 'release.tar.gz'

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def test_accepts_complete_regular_file_archive(self) -> None:
        create_archive(self.archive)
        self.assertGreater(VALIDATOR.validate(str(self.archive), COMMIT)[0], 0)

    def test_rejects_environment_file(self) -> None:
        files = required_files()
        files['.env.production'] = b'DATABASE_URL=forbidden'
        create_archive(self.archive, files)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'environment file'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_prisma_migrations(self) -> None:
        files = required_files()
        files['prisma/migrations/001.sql'] = b'SELECT 1'
        create_archive(self.archive, files)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'Prisma migrations'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_path_traversal(self) -> None:
        files = required_files()
        files['../escape'] = b'forbidden'
        create_archive(self.archive, files)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'escapes the release root'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_accepts_internal_symbolic_link(self) -> None:
        link = tarfile.TarInfo('safe-link')
        link.type = tarfile.SYMTYPE
        link.linkname = 'server.js'
        create_archive(self.archive, extra_members=[link])
        self.assertGreater(VALIDATOR.validate(str(self.archive), COMMIT)[0], 0)

    def test_rejects_escaping_symbolic_link(self) -> None:
        link = tarfile.TarInfo('unsafe-link')
        link.type = tarfile.SYMTYPE
        link.linkname = '../server.js'
        create_archive(self.archive, extra_members=[link])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'escapes the release root'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_member_below_symbolic_link(self) -> None:
        directory = tarfile.TarInfo('real-directory')
        directory.type = tarfile.DIRTYPE
        link = tarfile.TarInfo('alias')
        link.type = tarfile.SYMTYPE
        link.linkname = 'real-directory'
        child = tarfile.TarInfo('alias/child')
        child.size = 0
        create_archive(self.archive, extra_members=[directory, link, child])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'traverses a symlink'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_symbolic_link_cycle(self) -> None:
        first = tarfile.TarInfo('first-link')
        first.type = tarfile.SYMTYPE
        first.linkname = 'second-link'
        second = tarfile.TarInfo('second-link')
        second.type = tarfile.SYMTYPE
        second.linkname = 'first-link'
        create_archive(self.archive, extra_members=[first, second])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'cycle'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_symbolic_link_to_ancestor(self) -> None:
        directory = tarfile.TarInfo('directory')
        directory.type = tarfile.DIRTYPE
        link = tarfile.TarInfo('directory/loop')
        link.type = tarfile.SYMTYPE
        link.linkname = '.'
        create_archive(self.archive, extra_members=[directory, link])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'recursively targets an ancestor'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_server_controlled_checksum(self) -> None:
        files = required_files()
        files['DEPLOYMENT_CHECKSUM'] = b'forbidden'
        create_archive(self.archive, files)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'server-controlled'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_hard_link(self) -> None:
        link = tarfile.TarInfo('unsafe-hard-link')
        link.type = tarfile.LNKTYPE
        link.linkname = 'server.js'
        create_archive(self.archive, extra_members=[link])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'non-file member'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_duplicate_member(self) -> None:
        duplicate = tarfile.TarInfo('server.js')
        duplicate.size = 0
        create_archive(self.archive, extra_members=[duplicate])
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'duplicate member'):
            VALIDATOR.validate(str(self.archive), COMMIT)

    def test_rejects_wrong_commit(self) -> None:
        create_archive(self.archive)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'artifact commit'):
            VALIDATOR.validate(str(self.archive), 'f' * 40)

    def test_rejects_wrong_node_version(self) -> None:
        files = required_files()
        files['deployment-metadata.json'] = json.dumps(
            {
                'commit': COMMIT,
                'nodeVersion': 'v24.0.0',
            }
        ).encode()
        create_archive(self.archive, files)
        with self.assertRaisesRegex(VALIDATOR.ValidationError, 'Node v22.12.0'):
            VALIDATOR.validate(str(self.archive), COMMIT)


if __name__ == '__main__':
    unittest.main()
