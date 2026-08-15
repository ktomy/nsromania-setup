#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import sys
import tarfile
from pathlib import PurePosixPath


MAX_MEMBERS = 250_000
MAX_EXPANDED_BYTES = 2_500_000_000
MAX_MEMBER_BYTES = 1_000_000_000
MAX_PATH_LENGTH = 1_024
REQUIRED_MEMBERS = {
    'server.js',
    'package.json',
    'RELEASE_SHA',
    'deployment-metadata.json',
    '.next/BUILD_ID',
    'public/join.html',
    'emails/welcome.html',
    'emails/email_validation.html',
    'emails/sign_in.html',
    'emails/registration_notification.html',
    'messages/en.json',
    'messages/ro.json',
}


class ValidationError(Exception):
    pass


def normalized_member_name(name: str) -> str:
    if name in ('.', './'):
        return ''
    if '\x00' in name or '\n' in name or '\r' in name or '\\' in name:
        raise ValidationError('archive member contains a forbidden control character')
    if len(name) > MAX_PATH_LENGTH:
        raise ValidationError('archive member path is too long')

    path = PurePosixPath(name)
    if path.is_absolute():
        raise ValidationError(f'archive member uses an absolute path: {name!r}')

    parts = tuple(part for part in path.parts if part not in ('', '.'))
    if not parts or '..' in parts:
        raise ValidationError(f'archive member escapes the release root: {name!r}')

    return PurePosixPath(*parts).as_posix()


def validate(archive_path: str, expected_commit: str) -> tuple[int, int]:
    if re.fullmatch(r'[0-9a-f]{40}', expected_commit) is None:
        raise ValidationError('expected commit must be a 40-character lowercase hexadecimal SHA')

    names: set[str] = set()
    member_kinds: dict[str, str] = {}
    symbolic_links: dict[str, str] = {}
    total_size = 0
    release_member: tarfile.TarInfo | None = None
    metadata_member: tarfile.TarInfo | None = None

    with tarfile.open(archive_path, mode='r:gz') as archive:
        members = archive.getmembers()
        if len(members) > MAX_MEMBERS:
            raise ValidationError('archive contains too many members')

        for member in members:
            name = normalized_member_name(member.name)
            if name == '':
                if not member.isdir():
                    raise ValidationError('archive root entry is not a directory')
                continue
            if name in names:
                raise ValidationError(f'archive contains a duplicate member: {name!r}')
            names.add(name)

            parts = PurePosixPath(name).parts
            if any(part == '.env' or part.startswith('.env.') for part in parts):
                raise ValidationError(f'archive contains an environment file: {name!r}')
            if any(parts[index : index + 2] == ('prisma', 'migrations') for index in range(len(parts) - 1)):
                raise ValidationError(f'archive contains Prisma migrations: {name!r}')
            if name == 'DEPLOYMENT_CHECKSUM':
                raise ValidationError('archive contains server-controlled deployment metadata')

            if member.issym():
                member_kinds[name] = 'symlink'
                symbolic_links[name] = member.linkname
            elif member.isfile():
                member_kinds[name] = 'file'
            elif member.isdir():
                member_kinds[name] = 'directory'
            else:
                raise ValidationError(f'archive contains a non-file member: {name!r}')

            if member.isfile():
                if member.size > MAX_MEMBER_BYTES:
                    raise ValidationError(f'archive member is too large: {name!r}')
                total_size += member.size
                if total_size > MAX_EXPANDED_BYTES:
                    raise ValidationError('archive expands beyond the configured safety limit')

            if name == 'RELEASE_SHA':
                release_member = member
            elif name == 'deployment-metadata.json':
                metadata_member = member

        missing = sorted(REQUIRED_MEMBERS - names)
        if missing:
            raise ValidationError(f'archive is missing required members: {", ".join(missing)}')

        traced_packages = {
            'node_modules/pm2': '/node_modules/pm2/package.json',
            'node_modules/@prisma/client': '/node_modules/@prisma/client/package.json',
            'node_modules/@swc/helpers': '/node_modules/@swc/helpers/package.json',
        }
        for package_alias, package_suffix in traced_packages.items():
            if package_alias not in names or not any(name.endswith(package_suffix) for name in names):
                raise ValidationError(f'archive is missing traced package: {package_alias}')

        prisma_runtime_suffixes = (
            '/node_modules/@prisma/client/runtime/client.js',
            '/node_modules/@prisma/client/runtime/query_compiler_fast_bg.mysql.mjs',
            '/node_modules/@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.mjs',
        )
        for suffix in prisma_runtime_suffixes:
            if not any(name.endswith(suffix) for name in names):
                raise ValidationError(f'archive is missing Prisma runtime file: {suffix}')

        normalized_link_targets: dict[str, str] = {}
        for link_name, link_target in symbolic_links.items():
            if (
                not link_target
                or len(link_target) > MAX_PATH_LENGTH
                or '\x00' in link_target
                or '\n' in link_target
                or '\r' in link_target
                or '\\' in link_target
                or PurePosixPath(link_target).is_absolute()
            ):
                raise ValidationError(f'archive symlink has a forbidden target: {link_name!r}')

            target_parts: list[str] = list(PurePosixPath(link_name).parent.parts)
            for part in PurePosixPath(link_target).parts:
                if part in ('', '.'):
                    continue
                if part == '..':
                    if not target_parts:
                        raise ValidationError(f'archive symlink escapes the release root: {link_name!r}')
                    target_parts.pop()
                else:
                    target_parts.append(part)
            if not target_parts:
                raise ValidationError(f'archive symlink targets the release root: {link_name!r}')
            normalized_target = PurePosixPath(*target_parts).as_posix()
            if PurePosixPath(link_name).is_relative_to(PurePosixPath(normalized_target)):
                raise ValidationError(f'archive symlink recursively targets an ancestor: {link_name!r}')
            normalized_link_targets[link_name] = normalized_target

        for name in names:
            parts = PurePosixPath(name).parts
            for index in range(1, len(parts)):
                ancestor = PurePosixPath(*parts[:index]).as_posix()
                if ancestor in symbolic_links:
                    raise ValidationError(f'archive member traverses a symlink: {name!r}')

        def resolve_link(path: str, seen: set[str]) -> str:
            parts = list(PurePosixPath(path).parts)
            for index in range(1, len(parts) + 1):
                candidate = PurePosixPath(*parts[:index]).as_posix()
                if candidate not in normalized_link_targets:
                    continue
                if candidate in seen:
                    raise ValidationError(f'archive symlink cycle contains: {candidate!r}')
                remainder = parts[index:]
                replacement = list(PurePosixPath(normalized_link_targets[candidate]).parts)
                return resolve_link(PurePosixPath(*(replacement + remainder)).as_posix(), seen | {candidate})
            return path

        for link_name, link_target in normalized_link_targets.items():
            resolved_target = resolve_link(link_target, {link_name})
            if resolved_target not in names:
                raise ValidationError(f'archive symlink target is missing: {link_name!r}')
            if member_kinds[resolved_target] not in ('file', 'directory'):
                raise ValidationError(f'archive symlink does not resolve to a file or directory: {link_name!r}')

        if release_member is None or not release_member.isfile() or release_member.size > 128:
            raise ValidationError('RELEASE_SHA is not a small regular file')

        release_file = archive.extractfile(release_member)
        if release_file is None:
            raise ValidationError('unable to read RELEASE_SHA')
        release_commit = release_file.read().decode('ascii', errors='strict').strip()
        if release_commit != expected_commit:
            raise ValidationError('artifact commit does not match the requested commit')

        if metadata_member is None or not metadata_member.isfile() or metadata_member.size > 16_384:
            raise ValidationError('deployment metadata is not a small regular file')
        metadata_file = archive.extractfile(metadata_member)
        if metadata_file is None:
            raise ValidationError('unable to read deployment metadata')
        metadata = json.loads(metadata_file.read().decode('utf8', errors='strict'))
        if metadata.get('commit') != expected_commit:
            raise ValidationError('deployment metadata commit does not match the requested commit')
        if metadata.get('nodeVersion') != 'v22.12.0':
            raise ValidationError('artifact was not built with Node v22.12.0')

    return total_size, len(members)


def main() -> int:
    if len(sys.argv) != 3:
        print(f'Usage: {sys.argv[0]} ARCHIVE COMMIT_SHA', file=sys.stderr)
        return 2

    try:
        expanded_bytes, member_count = validate(sys.argv[1], sys.argv[2])
    except (OSError, tarfile.TarError, UnicodeError, ValidationError) as error:
        print(f'Artifact validation failed: {error}', file=sys.stderr)
        return 1

    print(expanded_bytes, member_count)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
