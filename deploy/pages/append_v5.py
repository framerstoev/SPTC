"""Append the explicitly authorized V5 release after V4, preserving every prior file."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re


def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def append(artifact: Path, repo: Path | None = None):
    repo = repo or Path(__file__).resolve().parents[2]
    artifact = artifact.resolve()
    assert artifact.is_dir() and (artifact/'coldwave-demo-v4/index.html').is_file()
    source = repo/'roadway-resilience-v5'
    manifest = json.loads((repo/'deploy/pages/v5-public-files.json').read_text(encoding='utf-8'))
    record = repo/'deploy/pages/v5-release-record.json'
    assert digest(record)==manifest['release_record_sha256']
    approval = json.loads(record.read_text(encoding='utf-8'))
    assert approval['authorization']['processed_CS_products_and_roadway_visualizations'] is True
    assert approval['authorization']['reference']=='8ff5010f-f105-4b16-ac16-2b033ebfa2d1'
    assert approval['authorization']['independently_verified_license_exception'] is False
    files = {p.relative_to(source).as_posix(): p for p in source.rglob('*') if p.is_file()}
    assert len(files)==manifest['file_count']==9616 and set(files)==set(manifest['files'])
    presentation_assets = {"data/v5p/relative.json", "data/v5t/percentiles.json", "data/v5v/peak-loss.json"}
    assert set(approval["added_presentation_data"]) == presentation_assets
    assert presentation_assets <= set(files)
    assert not any(p.is_symlink() for p in source.rglob('*'))
    secret = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}')
    private = re.compile(rb'(?<![A-Za-z])[A-Za-z]:[\\/]|file://|/Users/|/home/[^/]+/|\.local/|data/tier3/',re.I)
    for name,p in files.items():
        rel=PurePosixPath(name);expected=manifest['files'][name]
        assert not rel.is_absolute() and '..' not in rel.parts
        assert rel.suffix in {'.json','.geojson','.js','.html','.css','.png','.md','.txt'} or name=='.nojekyll'
        assert p.stat().st_size==expected['bytes'] and digest(p)==expected['sha256'],name
        raw=p.read_bytes();assert not secret.search(raw) and not private.search(raw),name
        assert len(raw)<100*1024**2
    policy=json.loads((source/'data/v5-release.json').read_text(encoding='utf-8'))
    assert policy['release_id']==manifest['release_id']==approval['release_id']
    assert policy['payload_sha256']==approval['payload_sha256']
    assert set(policy['files'])=={n for n in files if n.startswith('data/') and n!='data/v5-release.json'}
    for name,row in policy['files'].items():assert row==manifest['files'][name],name
    assert len([n for n in files if n.startswith('data/curves/')])==3842
    assert len([n for n in files if n.startswith('data/beryl/curves/')])==5698
    before={p.relative_to(artifact).as_posix():digest(p) for p in artifact.rglob('*') if p.is_file()}
    target=artifact/'roadway-resilience-v5';assert not target.exists(),'Never overwrite a published version'
    total_before=sum(p.stat().st_size for p in artifact.rglob('*') if p.is_file())
    assert total_before+manifest['total_bytes']<1_000_000_000,'GitHub Pages site-size limit'
    target.mkdir()
    for name,p in files.items():
        out=target/name;out.parent.mkdir(parents=True,exist_ok=True)
        with out.open('xb') as stream:stream.write(p.read_bytes())
    assert all(digest(artifact/n)==h for n,h in before.items()),'Prior site changed'
    total=sum(p.stat().st_size for p in artifact.rglob('*') if p.is_file())
    assert total==total_before+manifest['total_bytes']<1_000_000_000
    return {'passed':True,'status':'V5_APPEND_VERIFIED','v5_files':len(files),'v5_bytes':manifest['total_bytes'],
            'preserved_files':len(before),'prior_files_unchanged':True,'complete_artifact_bytes':total,'headroom_bytes':1_000_000_000-total}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--artifact',required=True,type=Path)
    parser.add_argument('--repo',type=Path);a=parser.parse_args()
    print(json.dumps(append(a.artifact,a.repo)))
