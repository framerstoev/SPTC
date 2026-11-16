"""Reproducible, lossless V5N static publication copy. Never modifies scientific sources."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

ORIGIN = 'https://framerstoev.github.io'
BASE_PATH = '/SPTC/roadway-resilience-v5/'
INSTRUCTION = '8ff5010f-f105-4b16-ac16-2b033ebfa2d1'


def sha(raw): return hashlib.sha256(raw).hexdigest()
def dump(value): return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)+'\n').encode()
def replace(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)


def prepare(source: Path, output: Path, metadata: Path):
    assert source.is_dir() and not output.exists() and not metadata.exists()
    original = {p.relative_to(source).as_posix(): p.read_bytes() for p in sorted(source.rglob('*')) if p.is_file()}
    assert len(original) == 9605
    source_hash = sha(dump({n: sha(v) for n,v in original.items()}))
    version = 'v5n-public-' + source_hash[:12]
    payload = dict(original)
    # Only public provenance metadata changes; all scientific arrays and geometry retain exact bytes.
    for name in ['data/beryl/o1_v1/manifest.json', 'data/beryl/impact_focus/manifest.json', 'data/network-context-manifest.json']:
        value = json.loads(payload[name])
        for key in ['source_artifacts', 'sources', 'source']:
            value.pop(key, None)
        for field in value.get('fields', []):
            field.pop('scientific_source', None)
        value['public_provenance'] = {'source_manifest_sha256': sha(original[name]), 'source': 'Accepted SPTC research product; project provenance retained privately', 'scientific_payload_unchanged': True}
        payload[name] = dump(value)
    text = payload['js/events.js'].decode()
    text = replace(text, '    if (!D.localHost(location.hostname)) throw new Error("Beryl research preview requires localhost");', '    await V4Release.authorize("beryl_2024_07");')
    text = replace(text, 'mode: D.LOCAL, manifest, geometry', 'mode: D.FULL, manifest, geometry')
    text = replace(text, '    if (!cache.has(key))', '    await V4Release.authorize(key);\n    if (!cache.has(key))')
    payload['js/events.js'] = text.encode()
    text = payload['js/data.js'].decode()
    text = replace(text, '    const response = await fetch(url,', '    expected ||= root.V4Release?.integrity(url) || null;\n    const response = await fetch(url,')
    text = text.replace('data.mode === FULL ? "Published research evidence"', 'data.mode === FULL ? "Research Dashboard"')
    text = text.replace('if (data.beryl) return "Qualified internal research · P2 / E2";', 'if (data.beryl) return "Qualified research · P2 / E2 / O1-V1";')
    payload['js/data.js'] = text.encode()
    text = payload['index.html'].decode()
    text = replace(text, '  <script defer src="./js/data.js"></script>', '  <script defer src="./js/data.js"></script>\n  <script defer src="./js/release.js"></script>')
    text = text.replace('Local research preview', 'Research Dashboard')
    text = replace(text, '<span class="version-tag">V4</span>', '<span class="version-tag">V5</span>')
    payload['index.html'] = text.encode()
    text = payload['js/beryl-docs.js'].decode()
    text = replace(text, 'Public release and deployment are separate decisions.', 'These processed CS-level research products are authorized for public dissemination under the separate V5 release record; historical scientific acceptance remains distinct.')
    text = text.replace('PRISM Group, Oregon State University; ERA5 / Copernicus; NHC source track; NPMRDS-derived observed traffic evidence; TxDOT roadway context.', 'PRISM Group, Oregon State University, https://prism.oregonstate.edu; ERA5 / Copernicus Climate Change Service (C3S); NOAA / NHC source track; INRIX NPMRDS-derived observed traffic evidence; Texas Department of Transportation (TxDOT – TPP – Data Management) roadway context. Researcher confirms institutional publication permissions; this is not a provider-certified operational product.')
    payload['js/beryl-docs.js'] = text.encode()
    # Same required INRIX/FHWA attribution; no new scientific interpretation.
    text = payload['js/docs.js'].decode()
    needle = '  const presentationEvent ='
    text = replace(text, needle, '  sections.push(["public-release", "Public Research Release and Sources", ["V5N public research release: processed CS-level indices, trajectories and conditional summaries, authorized by the researcher as covered by institutional publication permissions. This record is not an independently verified third-party license exception. Original research manifests and qualifications remain unchanged.", "INRIX is the source of the NPMRDS traffic observations used to derive these research summaries. This material is based upon work supported by the Federal Highway Administration under contract number 693JJ3-22-C-000008. Any opinions, findings and conclusions or recommendations expressed in this publication are those of the author(s) and do not necessarily reflect the views of the Federal Highway Administration.", "TxDOT control-section geometry and roadway context: Texas Department of Transportation, Transportation Planning and Programming, Data Management. Source-vintage/download metadata is incomplete; the accepted historical geometry is preserved, without substituting current public services. The researcher confirms the project holds the institutional permissions for these roadway visualizations. No commercial resale or official agency endorsement is claimed.", "PRISM Group, Oregon State University, https://prism.oregonstate.edu. Original access dates not established in available provenance are explicitly unresolved metadata; a processing date is not an access date. ERA5: Copernicus Climate Change Service (C3S); NOAA/NHC best-track context. No raw TMC speed/travel-time tables, volume-profile archives or economic ledgers are served."]]);\n' + needle)
    text = replace(text, '  V4J.docs(sections,presentationEvent);', '  V4J.docs(sections,presentationEvent);\n  const publicSources=sections.find(s=>s[0]==="sources");\n  if(publicSources)publicSources[2]=publicSources[2].map(t=>t.replace("Beryl remains local research preview; January retains its separate public-release record.","January and Beryl processed research products are publicly released under the separate V5 publication record; original scientific acceptance and qualifications remain unchanged."));\n  setChapter("version","V5 Public Research Release",["The accepted V5N native dashboard is published as a separate multi-event research release. January and Beryl retain distinct accepted methods and support. Original January V4 remains available at its existing URL. Public publication does not imply official agency adoption or change scientific acceptance."]);')
    payload['js/docs.js'] = text.encode()
    for name in ['index.html', 'docs.html']:
        text = payload[name].decode()
        text = re.sub(r'(\./(?:js|css)/[^"?]+\.(?:js|css))(?:\?v=[^"\s]+)?', lambda m:m[1]+'?v='+version, text)
        payload[name] = text.encode()
    scientific = {n: {'bytes':len(v), 'sha256':sha(v)} for n,v in payload.items() if n.startswith('data/')}
    policy = {'schema_version':1,'release_id':version,'baseline':'V5N','mode':'PUBLIC_ANALYTICAL',
              'public_origin':ORIGIN,'base_path':BASE_PATH,'event_ids':['beryl_2024_07','coldwave_2026_01'],
              'section_counts':{'beryl_2024_07':5763,'coldwave_2026_01':10029},
              'curve_counts':{'beryl_2024_07':5698,'coldwave_2026_01':3842},
              'o1a_qualified':3097,'o1b_qualified':943,
              'authorization':{'kind':'RESEARCHER_INSTITUTIONAL_PUBLICATION_PERMISSION_REPRESENTATION','reference':INSTRUCTION,'processed_CS_products_and_roadway_visualizations':True,'independently_verified_license_exception':False},
              'historical_science_manifests_unchanged':True,'source_runtime_index_sha256':source_hash,
              'files':scientific,'payload_sha256':sha(dump(scientific)),
              'qualification':'Qualified research summaries; not causal damage, physical recovery certification or agency adoption.'}
    payload['data/v5-release.json'] = dump(policy)
    declaration = {'bytes':len(payload['data/v5-release.json']), 'sha256':sha(payload['data/v5-release.json'])}
    payload['js/release.js'] = ('''/* Explicit V5 publication context and integrity policy. No scientific calculations. */
(function(root){
  "use strict";
  const ORIGIN=ORIGIN_VALUE, PATH=PATH_VALUE, EXPECTED=EXPECTED_VALUE;
  let policy=null,pending=null;
  function allowed(value){const url=new URL(value);return (url.origin===ORIGIN||V4Data.localHost(url.hostname))&&new URL(".",url).pathname===PATH;}
  async function authorize(event){
    if(!allowed(location.href))throw Error("V5 is outside its authorized publication origin or base path");
    if(!pending)pending=V4Data.json("./data/v5-release.json",document.baseURI,EXPECTED).then(p=>{
      if(p.schema_version!==1||p.mode!=="PUBLIC_ANALYTICAL"||p.public_origin!==ORIGIN||p.base_path!==PATH||p.authorization?.reference!==AUTH_VALUE||p.authorization?.processed_CS_products_and_roadway_visualizations!==true||p.section_counts?.beryl_2024_07!==5763||p.section_counts?.coldwave_2026_01!==10029||p.curve_counts?.beryl_2024_07!==5698||p.curve_counts?.coldwave_2026_01!==3842||p.o1a_qualified!==3097||p.o1b_qualified!==943)throw Error("Invalid V5 public release policy");
      policy=p;return p;
    }).catch(error=>{pending=null;throw error;});
    const p=await pending;if(!p.event_ids.includes(event))throw Error("Event outside V5 release");return p;
  }
  function integrity(url){
    if(!policy)return null;
    if(!allowed(location.href)||url.origin!==location.origin)throw Error("Data outside V5 publication");
    const name=url.pathname.slice(PATH.length),record=policy.files[name];
    if(!url.pathname.startsWith(PATH)||!record)throw Error("Data absent from V5 public inventory");return record;
  }
  root.V4Release=Object.freeze({authorize,integrity,allowed});
})(window);
'''.replace('ORIGIN_VALUE',json.dumps(ORIGIN)).replace('PATH_VALUE',json.dumps(BASE_PATH)).replace('EXPECTED_VALUE',json.dumps(declaration)).replace('AUTH_VALUE',json.dumps(INSTRUCTION))).encode()
    assert len(payload)==9607
    # Pin exact science bytes for every curve, geometry, section table, summary and overlay.
    changed = sorted(n for n in original if original[n]!=payload[n])
    metadata_changes = {'data/beryl/o1_v1/manifest.json','data/beryl/impact_focus/manifest.json','data/network-context-manifest.json'}
    assert {n for n in changed if n.startswith('data/')}==metadata_changes
    private = re.compile(rb'(?<![A-Za-z])[A-Za-z]:[\\/]|file://|/Users/|/home/[^/]+/|\.local/|data/tier3/',re.I)
    for name,raw in payload.items():
        assert not private.search(raw), name
    output.mkdir(parents=True)
    for name,raw in payload.items():
        p=output/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    metadata.mkdir(parents=True)
    record={'release_id':version,'baseline':'V5N','authorization':policy['authorization'],'decision_reference':INSTRUCTION,
            'rights_basis':'Researcher confirms necessary institutional permissions for processed CS-level research products and roadway visualizations. Not an independently verified third-party exception.',
            'payload_sha256':policy['payload_sha256'],'data_categories':['CS summaries/statistics','dimensionless CS indices','aggregated hourly CS Q trajectories','research roadway visualizations'],
            'raw_TMC_speed_travel_time_baselines_or_volume_profiles_included':False,'source_vintage_metadata_gaps_retained':True,'original_science_unchanged':True}
    (metadata/'v5-release-record.json').write_bytes(dump(record))
    manifest={'release_id':version,'public_path':'roadway-resilience-v5','file_count':len(payload),'total_bytes':sum(map(len,payload.values())),
              'files':{n:{'bytes':len(v),'sha256':sha(v)} for n,v in payload.items()},'source_runtime_index_sha256':source_hash,
              'source_to_public':{n:'roadway-resilience-v5/'+n for n in original},'transformed_files':changed,
              'added_files':['js/release.js','data/v5-release.json'],'release_record_sha256':sha(dump(record)),
              'excluded':['raw TMC traffic and volume tables','source archives','local provenance paths','credentials','QA logs, screenshots and browser profiles','research freezes and workspaces','test fixtures and environments']}
    (metadata/'v5-public-files.json').write_bytes(dump(manifest))
    print(json.dumps({'passed':True,'files':len(payload),'bytes':manifest['total_bytes'],'changed':changed,'release_id':version}))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--metadata',type=Path,required=True)
    a=p.parse_args();prepare(a.source,a.output,a.metadata)
